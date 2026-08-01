import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { resolve as resolvePath } from "node:path";
import { evaluateCondition } from "./condition.js";
import type { HookDef, ServiceDef, TestfileDoc } from "./model.js";
import { resolvePorts } from "./ports.js";
import { walk, type RunNode, type Status } from "./runtree.js";
import { ServiceInstance } from "./services.js";
import { resolveEnvMap, resolveTemplate, type Scopes } from "./template.js";
import { formatMs, parseDurationMs, sleep } from "./util.js";

// Events: "update" (any state change), "node-start"/"node-end" (RunNode),
// "service-added" (ServiceInstance).
export interface RunnerOptions {
  // When set, only these node ids are executed; other nodes stay untouched.
  active?: Set<number>;
}

export class Runner extends EventEmitter {
  readonly services: ServiceInstance[] = [];
  ports: Record<string, number> = {};
  // The Testfile's own top-level env (resolved), for run records.
  docEnv: Record<string, string> = {};
  interrupted = false;
  readonly active?: Set<number>;

  private readonly abort = new AbortController();

  constructor(
    readonly doc: TestfileDoc,
    readonly root: RunNode,
    readonly baseDir: string,
    options: RunnerOptions = {}
  ) {
    super();
    this.active = options.active;
  }

  isActive(node: RunNode): boolean {
    return !this.active || this.active.has(node.id);
  }

  get finished(): boolean {
    return this.root.status !== "pending" && this.root.status !== "running";
  }

  // First Ctrl+C: stop tests, then let services shut down gracefully.
  requestStop(): void {
    this.interrupted = true;
    this.abort.abort();
    this.emitUpdate();
  }

  // Second Ctrl+C: SIGKILL everything.
  forceStop(): void {
    this.interrupted = true;
    this.abort.abort();
    for (const service of this.services) service.kill();
    this.emitUpdate();
  }

  async run(): Promise<Status> {
    const baseEnv: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env)) {
      if (value !== undefined) baseEnv[key] = value;
    }
    // Platform facts for `if` conditions, e.g. ${{ env.TESTFILE_OS }} == linux.
    baseEnv.TESTFILE_OS = process.platform;
    baseEnv.TESTFILE_ARCH = process.arch;
    const started: ServiceInstance[] = [];
    try {
      this.ports = await resolvePorts(this.doc.ports);
      const bootstrap: Scopes = { env: baseEnv, ports: this.ports, matrix: {} };
      this.docEnv = resolveEnvMap(this.doc.env, bootstrap, "Testfile");
      const scopes: Scopes = { ...bootstrap, env: { ...baseEnv, ...this.docEnv } };
      await this.startServices(this.doc.services, scopes, this.baseDir, started, this.abort);
      await this.runNode(this.root, scopes, this.baseDir, this.abort.signal);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.root.error = message;
      this.root.output.system(message);
      this.markRemaining(this.root, this.interrupted ? "aborted" : "failed");
      if (!this.interrupted) this.root.status = "failed";
    } finally {
      await this.stopServices(started);
    }
    this.emitUpdate();
    return this.root.status;
  }

  private async runNode(node: RunNode, scopes: Scopes, cwd: string, parentSignal: AbortSignal): Promise<void> {
    if (!this.isActive(node)) return;
    if (parentSignal.aborted) {
      this.markRemaining(node, this.interrupted ? "aborted" : "skipped");
      this.emitUpdate();
      return;
    }

    node.status = "running";
    node.startedAt = Date.now();
    this.emit("node-start", node);
    this.emitUpdate();

    const controller = new AbortController();
    const onParentAbort = () => controller.abort();
    parentSignal.addEventListener("abort", onParentAbort, { once: true });
    let timeoutHandle: NodeJS.Timeout | undefined;
    if (node.def.timeout !== undefined && !node.isMatrixWrapper) {
      const ms = parseDurationMs(node.def.timeout, 0);
      timeoutHandle = setTimeout(() => {
        node.timedOut = true;
        node.error = `timeout after ${formatMs(ms)}`;
        node.output.system(node.error);
        controller.abort();
      }, ms);
    }

    const started: ServiceInstance[] = [];
    // Assigned once the node's scopes exist; runs in finally so teardown
    // happens on success, failure and abort, before services stop.
    let teardown: (() => Promise<void>) | undefined;
    try {
      if (node.isMatrixWrapper) {
        // The wrapper only fans out; env/services/workdir apply per instance.
        await this.runChildrenParallel(node, scopes, cwd, controller.signal, node.def.maxParallel);
        this.finishGroup(node, controller.signal);
      } else {
        const where = `test "${node.name}"`;
        const matrix = { ...scopes.matrix, ...node.matrix };
        const withMatrix: Scopes = { ...scopes, matrix };
        const env = { ...withMatrix.env, ...resolveEnvMap(node.def.env, withMatrix, where) };
        for (const [key, value] of Object.entries(node.matrix)) {
          env[`TESTFILE_MATRIX_${key.toUpperCase()}`] = value;
        }
        const nodeScopes: Scopes = { ...withMatrix, env };

        if (node.def.if !== undefined && !evaluateCondition(node.def.if, nodeScopes, where)) {
          node.output.system(`skipped: condition not met (${node.def.if})`);
          node.skipReason = "condition";
          this.markRemaining(node, "skipped");
          node.endedAt = Date.now();
          this.emit("node-end", node);
          this.emitUpdate();
          return;
        }

        const nodeCwd = node.def.workdir
          ? resolvePath(cwd, resolveTemplate(node.def.workdir, nodeScopes, where))
          : cwd;

        if (node.def.teardown) {
          const hook = node.def.teardown;
          teardown = async () => {
            // No abort signal: cleanup runs to completion even on Ctrl+C.
            const ok = await this.runHook(node, hook, "teardown", nodeScopes, nodeCwd, undefined);
            if (!ok && node.status === "passed") {
              node.status = "failed";
              node.error = "teardown failed";
            }
          };
        }

        await this.startServices(node.def.services, nodeScopes, nodeCwd, started, controller, node.name);

        if (
          node.def.setup &&
          !(await this.runHook(node, node.def.setup, "setup", nodeScopes, nodeCwd, controller.signal))
        ) {
          for (const child of node.children) this.markRemaining(child, "skipped");
          node.status = this.interrupted ? "aborted" : "failed";
          node.error = "setup failed";
        } else {
          switch (node.kind) {
            case "command":
            case "script":
              await this.runShell(node, nodeScopes, nodeCwd, controller.signal);
              break;
            case "sequence":
              await this.runSequence(node, nodeScopes, nodeCwd, controller.signal);
              this.finishGroup(node, controller.signal);
              break;
            case "parallel":
              await this.runChildrenParallel(node, nodeScopes, nodeCwd, controller.signal, node.def.maxParallel);
              this.finishGroup(node, controller.signal);
              break;
          }
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      node.error = message;
      node.output.system(message);
      this.markRemaining(node, this.interrupted ? "aborted" : "skipped");
      node.status = this.interrupted ? "aborted" : "failed";
    } finally {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      parentSignal.removeEventListener("abort", onParentAbort);
      if (teardown) await teardown();
      await this.stopServices(started);
    }

    node.endedAt = Date.now();
    this.emit("node-end", node);
    this.emitUpdate();
  }

  private async runShell(node: RunNode, scopes: Scopes, cwd: string, signal: AbortSignal): Promise<void> {
    const retry = node.def.retry;
    const attempts = 1 + (typeof retry === "number" ? retry : (retry?.count ?? 0));
    const delayMs = typeof retry === "object" ? parseDurationMs(retry.delay, 0) : 0;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      await this.runShellAttempt(node, scopes, cwd, signal);
      if (node.status !== "failed" || signal.aborted || attempt === attempts) {
        if (node.status === "failed" && attempts > 1 && node.error) {
          node.error = `${node.error} (after ${attempt} attempts)`;
        }
        return;
      }
      node.output.system(
        `attempt ${attempt}/${attempts} failed, retrying${delayMs > 0 ? ` in ${formatMs(delayMs)}` : ""}`
      );
      node.status = "running";
      this.emitUpdate();
      if (delayMs > 0) await sleep(delayMs, signal);
    }
  }

  private runShellAttempt(node: RunNode, scopes: Scopes, cwd: string, signal: AbortSignal): Promise<void> {
    const source = node.kind === "script" ? node.def.script! : node.def.command!;
    const resolved = resolveTemplate(source, scopes, `test "${node.name}"`);
    return new Promise((resolve, reject) => {
      const child = spawn("sh", node.kind === "script" ? ["-e", "-c", resolved] : ["-c", resolved], {
        cwd,
        env: scopes.env,
        detached: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
      child.once("error", reject);
      child.stdout.on("data", (d) => node.output.append(d, "stdout"));
      child.stderr.on("data", (d) => node.output.append(d, "stderr"));

      let killTimer: NodeJS.Timeout | undefined;
      const onAbort = () => {
        signalGroup(child.pid, "SIGTERM");
        killTimer = setTimeout(() => signalGroup(child.pid, "SIGKILL"), 5000);
      };
      if (signal.aborted) onAbort();
      else signal.addEventListener("abort", onAbort, { once: true });

      // "close" (not "exit") so stdout/stderr are fully drained first.
      child.once("close", (code, sig) => {
        if (killTimer) clearTimeout(killTimer);
        signal.removeEventListener("abort", onAbort);
        node.output.flush();
        if (signal.aborted) {
          node.status = node.timedOut ? "failed" : this.interrupted ? "aborted" : "failed";
          if (!node.error) node.error = node.timedOut ? "timeout" : "aborted";
        } else if (code === 0) {
          node.status = "passed";
        } else {
          node.status = "failed";
          node.error = sig ? `terminated by ${sig}` : `exit code ${code}`;
          node.output.system(node.error);
        }
        resolve();
      });
    });
  }

  // Runs a setup/teardown hook, streaming into the node's output. Returns
  // whether the hook succeeded. Without a signal the hook cannot be aborted.
  private runHook(
    node: RunNode,
    hook: HookDef,
    label: "setup" | "teardown",
    scopes: Scopes,
    cwd: string,
    signal: AbortSignal | undefined
  ): Promise<boolean> {
    const where = `${label} of test "${node.name}"`;
    const env = { ...scopes.env, ...resolveEnvMap(hook.env, scopes, where) };
    const hookScopes: Scopes = { ...scopes, env };
    const hookCwd = hook.workdir
      ? resolvePath(cwd, resolveTemplate(hook.workdir, hookScopes, where))
      : cwd;
    const source = hook.script ?? hook.command;
    if (!source) return Promise.resolve(false);
    const resolved = resolveTemplate(source, hookScopes, where);
    node.output.system(`--- ${label} ---`);
    if (signal?.aborted) {
      node.output.system(`${label} not run (aborted)`);
      return Promise.resolve(false);
    }
    return new Promise((resolve) => {
      const child = spawn("sh", hook.script ? ["-e", "-c", resolved] : ["-c", resolved], {
        cwd: hookCwd,
        env,
        detached: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
      child.stdout.on("data", (d) => node.output.append(d, "stdout"));
      child.stderr.on("data", (d) => node.output.append(d, "stderr"));

      let killTimer: NodeJS.Timeout | undefined;
      let timedOut = false;
      const terminate = () => {
        signalGroup(child.pid, "SIGTERM");
        killTimer = setTimeout(() => signalGroup(child.pid, "SIGKILL"), 5000);
      };
      const timeoutMs = hook.timeout !== undefined ? parseDurationMs(hook.timeout, 0) : undefined;
      const timeoutTimer =
        timeoutMs !== undefined
          ? setTimeout(() => {
              timedOut = true;
              terminate();
            }, timeoutMs)
          : undefined;
      signal?.addEventListener("abort", terminate, { once: true });

      child.once("error", () => resolve(false));
      child.once("close", (code, sig) => {
        if (killTimer) clearTimeout(killTimer);
        if (timeoutTimer) clearTimeout(timeoutTimer);
        signal?.removeEventListener("abort", terminate);
        node.output.flush();
        const ok = code === 0 && !timedOut && !signal?.aborted;
        if (!ok) {
          node.output.system(
            `${label} failed (${timedOut ? "timeout" : (sig ?? `exit code ${code}`)})`
          );
        }
        resolve(ok);
      });
    });
  }

  private async runSequence(node: RunNode, scopes: Scopes, cwd: string, signal: AbortSignal): Promise<void> {
    let failed = false;
    for (const child of node.children) {
      if (failed || signal.aborted) {
        this.markRemaining(child, signal.aborted && this.interrupted ? "aborted" : "skipped");
        this.emitUpdate();
        continue;
      }
      await this.runNode(child, scopes, cwd, signal);
      if ((child.status === "failed" || child.status === "aborted") && !child.def.continueOnError) {
        failed = true;
      }
    }
  }

  private async runChildrenParallel(
    node: RunNode,
    scopes: Scopes,
    cwd: string,
    signal: AbortSignal,
    maxParallel: number | undefined
  ): Promise<void> {
    const children = node.children;
    // Matrix instances share their test's def (including any needs meant for
    // the wrapper's siblings), so needs scheduling only applies to real
    // parallel groups.
    const useNeeds = !node.isMatrixWrapper && children.some((child) => child.def.needs?.length);
    if (!useNeeds) {
      let index = 0;
      const workerCount = Math.min(maxParallel ?? children.length, children.length);
      const workers = Array.from({ length: Math.max(1, workerCount) }, async () => {
        while (index < children.length) {
          const child = children[index++];
          await this.runNode(child, scopes, cwd, signal);
        }
      });
      await Promise.all(workers);
      return;
    }

    const byName = new Map(children.map((child) => [child.name, child]));
    const semaphore = new Semaphore(maxParallel ?? children.length);
    const promises = new Map<RunNode, Promise<void>>();
    const runChild = (child: RunNode): Promise<void> => {
      let promise = promises.get(child);
      if (!promise) {
        promise = (async () => {
          // Siblings excluded by filters are treated as satisfied: the user
          // deliberately chose to run a subset.
          const needed = (child.def.needs ?? [])
            .map((name) => byName.get(name))
            .filter((n): n is RunNode => n !== undefined && this.isActive(n));
          await Promise.all(needed.map(runChild));
          // A condition-skip satisfies dependents; a needs-skip or failure
          // cascades down the chain.
          const blocker = needed.find(
            (n) =>
              n.status !== "passed" &&
              !(n.status === "skipped" && n.skipReason === "condition")
          );
          if (blocker && !signal.aborted) {
            child.output.system(`skipped: needs "${blocker.name}" which ${blocker.status}`);
            child.skipReason = "needs";
            this.markRemaining(child, "skipped");
            this.emitUpdate();
            return;
          }
          await semaphore.acquire();
          try {
            await this.runNode(child, scopes, cwd, signal);
          } finally {
            semaphore.release();
          }
        })();
        promises.set(child, promise);
      }
      return promise;
    };
    await Promise.all(children.map(runChild));
  }

  private finishGroup(node: RunNode, signal: AbortSignal): void {
    const failing = node.children.some(
      (child) =>
        (child.status === "failed" || child.status === "aborted") && !child.def.continueOnError
    );
    const ran = node.children.filter((child) => this.isActive(child));
    if (node.timedOut) node.status = "failed";
    else if (signal.aborted && this.interrupted) node.status = "aborted";
    else if (failing) node.status = "failed";
    else if (ran.length > 0 && ran.every((child) => child.status === "skipped")) node.status = "skipped";
    else node.status = "passed";
  }

  private async startServices(
    defs: Record<string, ServiceDef> | undefined,
    scopes: Scopes,
    cwd: string,
    sink: ServiceInstance[],
    controller: AbortController,
    owner = "Testfile"
  ): Promise<void> {
    const entries = Object.entries(defs ?? {});
    if (entries.length === 0) return;
    const instances = entries.map(([name, def]) => new ServiceInstance(name, def));
    for (const instance of instances) {
      instance.owner = owner;
      // A service dying while its tests run aborts the dependent subtree.
      instance.onUnexpectedExit = () => controller.abort();
      instance.on("update", () => this.emitUpdate());
      this.services.push(instance);
      sink.push(instance);
      this.emit("service-added", instance);
    }
    this.emitUpdate();
    await Promise.all(instances.map((instance) => instance.start(scopes, cwd, controller.signal)));
  }

  private async stopServices(started: ServiceInstance[]): Promise<void> {
    for (const service of [...started].reverse()) {
      await service.stop().catch(() => {});
    }
  }

  private emitUpdate(): void {
    this.emit("update");
  }

  // Marks a node and its not-yet-finished active descendants with a final status.
  private markRemaining(node: RunNode, status: Status): void {
    walk(node, (n) => {
      if (!this.isActive(n)) return;
      if (n.status === "pending" || n.status === "running") n.status = status;
    });
  }
}

class Semaphore {
  private queue: (() => void)[] = [];

  constructor(private available: number) {}

  acquire(): Promise<void> {
    if (this.available > 0) {
      this.available--;
      return Promise.resolve();
    }
    return new Promise((resolve) => this.queue.push(resolve));
  }

  release(): void {
    const next = this.queue.shift();
    if (next) next();
    else this.available++;
  }
}

function signalGroup(pid: number | undefined, signal: NodeJS.Signals): void {
  if (!pid) return;
  try {
    process.kill(-pid, signal);
  } catch {
    try {
      process.kill(pid, signal);
    } catch {
      // already gone
    }
  }
}

