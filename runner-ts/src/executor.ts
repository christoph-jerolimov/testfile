import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { resolve as resolvePath } from "node:path";
import type { ServiceDef, TestfileDoc } from "./model.js";
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
        const nodeCwd = node.def.workdir
          ? resolvePath(cwd, resolveTemplate(node.def.workdir, nodeScopes, where))
          : cwd;

        await this.startServices(node.def.services, nodeScopes, nodeCwd, started, controller, node.name);
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
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      node.error = message;
      node.output.system(message);
      this.markRemaining(node, this.interrupted ? "aborted" : "skipped");
      node.status = this.interrupted ? "aborted" : "failed";
    } finally {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      parentSignal.removeEventListener("abort", onParentAbort);
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
    let index = 0;
    const workerCount = Math.min(maxParallel ?? children.length, children.length);
    const workers = Array.from({ length: Math.max(1, workerCount) }, async () => {
      while (index < children.length) {
        const child = children[index++];
        await this.runNode(child, scopes, cwd, signal);
      }
    });
    await Promise.all(workers);
  }

  private finishGroup(node: RunNode, signal: AbortSignal): void {
    const failing = node.children.some(
      (child) =>
        (child.status === "failed" || child.status === "aborted") && !child.def.continueOnError
    );
    if (node.timedOut) node.status = "failed";
    else if (signal.aborted && this.interrupted) node.status = "aborted";
    else node.status = failing ? "failed" : "passed";
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

