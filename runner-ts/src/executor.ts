import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { resolve as resolvePath } from "node:path";
import { explainInputsMiss, ResultCache, type InputsState } from "./cache.js";
import { evaluateCondition } from "./condition.js";
import { loadEnvFiles } from "./envfile.js";
import { baseEnv as hostBaseEnv, forwardedEnv, prefixedEnv } from "./hostenv.js";
import type { HookDef, ServiceDef, TestContainerDef, TestfileDoc } from "./model.js";
import { resolvePorts } from "./ports.js";
import { walk, type RunTest, type Status } from "./runsuite.js";
import { ServiceInstance, sharedServiceKey } from "./services.js";
import { buildTestContainerArgs } from "./testcontainer.js";
import { resolveEnvMap, resolveTemplate, type Scopes } from "./template.js";
import { formatMs, parseDurationMs, sleep } from "./util.js";

// Events: "update" (any state change), "test-start"/"test-end" (RunTest),
// "service-added" (ServiceInstance).
export interface RunnerOptions {
  // When set, only these test ids are executed; other nodes stay untouched.
  active?: Set<number>;
  // Abort the whole run at the first test failure.
  failFast?: boolean;
  // Global cap on concurrently running command/script tests, across all
  // groups and matrix instances (group-level maxParallel still applies).
  maxParallel?: number;
  // Result cache for tests declaring `inputs`.
  cache?: ResultCache;
  // Additional host-env forward patterns (e.g. from --forward-env), applied
  // on top of the document's forwardEnv.
  forwardEnv?: string[];
  // Per-test notes about why the selection picked a test (e.g. which
  // --changed pattern matched); logged and recorded with the test.
  selectionNotes?: Map<number, string>;
}

// A started service as seen by one test: releasing it stops the service, or
// - for shared services - decrements the reference count.
interface ServiceHandle {
  instance: ServiceInstance;
  release: () => Promise<void>;
}

export class Runner extends EventEmitter {
  readonly services: ServiceInstance[] = [];
  ports: Record<string, number> = {};
  // The Testfile's own top-level env (resolved), for run records.
  docEnv: Record<string, string> = {};
  // Values loaded from env files; masked when logs are persisted.
  readonly secrets = new Set<string>();
  interrupted = false;
  failFastTriggered = false;
  readonly active?: Set<number>;

  private readonly abort = new AbortController();
  private readonly failFast: boolean;
  private readonly cache?: ResultCache;
  private readonly selectionNotes?: Map<number, string>;
  private readonly forwardEnv: string[];
  private readonly globalSlots?: Semaphore;
  // Running shared services, keyed by name + resolved configuration.
  private readonly sharedPool = new Map<
    string,
    {
      instance: ServiceInstance;
      refs: number;
      controllers: Set<AbortController>;
      started: Promise<void>;
    }
  >();

  constructor(
    readonly doc: TestfileDoc,
    readonly root: RunTest,
    readonly baseDir: string,
    options: RunnerOptions = {},
  ) {
    super();
    this.active = options.active;
    this.failFast = options.failFast ?? false;
    this.cache = options.cache;
    this.selectionNotes = options.selectionNotes;
    this.forwardEnv = options.forwardEnv ?? [];
    if (options.maxParallel !== undefined) this.globalSlots = new Semaphore(options.maxParallel);
  }

  isActive(test: RunTest): boolean {
    return !this.active || this.active.has(test.id);
  }

  private containerFor(test: RunTest): TestContainerDef | undefined {
    return nearestContainer(test);
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
    // Tests run in a clean environment: essentials + runner defaults, plus
    // whatever the Testfile's / the CLI's forwardEnv patterns let through.
    const baseEnv = hostBaseEnv([...(this.doc.forwardEnv ?? []), ...this.forwardEnv]);
    // TESTFILE_SECRET_* is in that environment already; what it still needs
    // is masking, so nothing it carries reaches a log or the record.
    for (const value of prefixedEnv().secretValues) this.secrets.add(value);
    // Platform facts for `if` conditions, e.g. ${{ env.TESTFILE_OS }} == linux.
    baseEnv.TESTFILE_OS = process.platform;
    baseEnv.TESTFILE_ARCH = process.arch;
    const started: ServiceHandle[] = [];
    try {
      this.ports = await resolvePorts(this.doc.ports);
      const bootstrap: Scopes = { env: baseEnv, ports: this.ports, matrix: {} };
      const fileEnv = loadEnvFiles(
        this.doc.envFile,
        this.baseDir,
        bootstrap,
        "Testfile",
        this.secrets,
      );
      const withFiles = { ...baseEnv, ...fileEnv };
      // Secrets named at document level come from the host (that is how CI
      // secret stores hand them over) and are registered for masking.
      const docSecrets = collectSecrets(this.doc.secrets, withFiles, this.secrets);
      Object.assign(withFiles, docSecrets);
      this.docEnv = resolveEnvMap(this.doc.env, { ...bootstrap, env: withFiles }, "Testfile");
      // ... and a value assigned to a secret name in `env` is secret too
      registerSecretValues(this.doc.secrets, this.docEnv, this.secrets);
      const scopes: Scopes = { ...bootstrap, env: { ...withFiles, ...this.docEnv } };
      await this.startServices(this.doc.services, scopes, this.baseDir, started, this.abort);
      await this.runTest(this.root, scopes, this.baseDir, this.abort.signal);
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

  private async runTest(
    test: RunTest,
    scopes: Scopes,
    cwd: string,
    parentSignal: AbortSignal,
  ): Promise<void> {
    if (!this.isActive(test)) return;
    if (parentSignal.aborted) {
      this.markRemaining(test, this.interrupted ? "aborted" : "skipped");
      this.emitUpdate();
      return;
    }

    test.status = "running";
    test.startedAt = Date.now();
    this.emit("test-start", test);
    this.emitUpdate();

    const controller = new AbortController();
    const onParentAbort = () => controller.abort();
    parentSignal.addEventListener("abort", onParentAbort, { once: true });
    let timeoutHandle: NodeJS.Timeout | undefined;
    if (test.def.timeout !== undefined && !test.isMatrixWrapper) {
      const ms = parseDurationMs(test.def.timeout, 0);
      timeoutHandle = setTimeout(() => {
        test.timedOut = true;
        test.error = `timeout after ${formatMs(ms)}`;
        test.output.system(test.error);
        controller.abort();
      }, ms);
    }

    const started: ServiceHandle[] = [];
    // Assigned once the test's scopes exist; runs in finally so teardown
    // happens on success, failure and abort, before services stop.
    let teardown: (() => Promise<void>) | undefined;
    let nodeCache: { key: string; state: InputsState } | undefined;
    try {
      if (test.isMatrixWrapper) {
        // The wrapper only fans out; env/services/workdir apply per instance.
        await this.runChildrenParallel(test, scopes, cwd, controller.signal, test.def.maxParallel);
        this.finishGroup(test, controller.signal);
      } else {
        const where = `test "${test.name}"`;
        const matrix = { ...scopes.matrix, ...test.matrix };
        const withMatrix: Scopes = { ...scopes, matrix };
        // precedence: parent env < forwarded host vars < this test's own env
        const forwarded = forwardedEnv(test.def.forwardEnv);
        const testSecrets = collectSecrets(test.def.secrets, withMatrix.env, this.secrets);
        const env = {
          ...withMatrix.env,
          ...forwarded,
          ...testSecrets,
          ...resolveEnvMap(test.def.env, withMatrix, where),
        };
        registerSecretValues(test.def.secrets, env, this.secrets);
        for (const [key, value] of Object.entries(test.matrix)) {
          env[`TESTFILE_MATRIX_${key.toUpperCase()}`] = value;
        }
        let nodeScopes: Scopes = { ...withMatrix, env };

        if (test.def.if !== undefined && !evaluateCondition(test.def.if, nodeScopes, where)) {
          test.output.system(`skipped: condition not met (${test.def.if})`);
          test.skipReason = "condition";
          this.markRemaining(test, "skipped");
          test.endedAt = Date.now();
          this.emit("test-end", test);
          this.emitUpdate();
          return;
        }

        const nodeCwd = test.def.workdir
          ? resolvePath(cwd, resolveTemplate(test.def.workdir, nodeScopes, where))
          : cwd;
        test.resolvedCwd = nodeCwd;

        if (test.def.envFile !== undefined) {
          const nodeFileEnv = loadEnvFiles(
            test.def.envFile,
            nodeCwd,
            nodeScopes,
            where,
            this.secrets,
          );
          // precedence: parent env < forwarded < secrets < env file(s) < own env
          const merged = {
            ...withMatrix.env,
            ...forwarded,
            ...testSecrets,
            ...nodeFileEnv,
            ...resolveEnvMap(test.def.env, withMatrix, where),
          };
          for (const [key, value] of Object.entries(test.matrix)) {
            merged[`TESTFILE_MATRIX_${key.toUpperCase()}`] = value;
          }
          nodeScopes = { ...withMatrix, env: merged };
        }

        if (this.cache && test.def.inputs && (test.kind === "command" || test.kind === "script")) {
          const source = resolveTemplate(test.def.script ?? test.def.command!, nodeScopes, where);
          const key = ResultCache.configKey(
            test.path,
            source,
            resolveEnvMap(test.def.env, withMatrix, where),
            test.matrix,
          );
          const state = ResultCache.inputsState(nodeCwd, test.def.inputs);
          const entry = this.cache.get(key);
          const note = this.selectionNotes?.get(test.id);
          if (entry && entry.hash === state.hash) {
            test.status = "passed";
            test.cached = true;
            test.reason = withNote(
              note,
              `cache hit: inputs unchanged (last passed ${entry.savedAt})`,
            );
            test.output.system(test.reason);
            test.endedAt = Date.now();
            this.emit("test-end", test);
            this.emitUpdate();
            return;
          }
          // Every test with `inputs` records why it actually ran, both in
          // its log and in the run record.
          test.reason = withNote(
            note,
            !this.cache.enabled
              ? "cache disabled (--no-cache)"
              : entry
                ? `cache miss: ${explainInputsMiss(entry, state, test.def.inputs)}`
                : "cache miss: no stored passing result for this configuration",
          );
          test.output.system(test.reason);
          nodeCache = { key, state };
        }

        if (test.def.teardown) {
          const hook = test.def.teardown;
          teardown = async () => {
            // No abort signal: cleanup runs to completion even on Ctrl+C.
            const ok = await this.runHook(test, hook, "teardown", nodeScopes, nodeCwd, undefined);
            if (!ok && test.status === "passed") {
              test.status = "failed";
              test.error = "teardown failed";
            }
          };
        }

        await this.startServices(
          test.def.services,
          nodeScopes,
          nodeCwd,
          started,
          controller,
          test.name,
        );

        if (
          test.def.setup &&
          !(await this.runHook(
            test,
            test.def.setup,
            "setup",
            nodeScopes,
            nodeCwd,
            controller.signal,
          ))
        ) {
          for (const child of test.children) this.markRemaining(child, "skipped");
          test.status = this.interrupted ? "aborted" : "failed";
          test.error = "setup failed";
        } else {
          switch (test.kind) {
            case "command":
            case "script":
              await this.runShell(test, nodeScopes, nodeCwd, controller.signal);
              break;
            case "sequence":
              await this.runSequence(test, nodeScopes, nodeCwd, controller.signal);
              this.finishGroup(test, controller.signal);
              break;
            case "parallel":
              await this.runChildrenParallel(
                test,
                nodeScopes,
                nodeCwd,
                controller.signal,
                test.def.maxParallel,
              );
              this.finishGroup(test, controller.signal);
              break;
          }
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      test.error = message;
      test.output.system(message);
      this.markRemaining(test, this.interrupted ? "aborted" : "skipped");
      test.status = this.interrupted ? "aborted" : "failed";
    } finally {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      parentSignal.removeEventListener("abort", onParentAbort);
      if (teardown) await teardown();
      await this.stopServices(started);
    }

    if (nodeCache && this.cache) {
      // only passing, actually-executed results are reusable
      // (assertion: the body methods assign the final status out of
      // TypeScript's narrowing sight)
      const finalStatus = test.status as Status;
      if (finalStatus === "passed") this.cache.put(nodeCache.key, nodeCache.state);
      else this.cache.invalidate(nodeCache.key);
    }

    test.endedAt = Date.now();
    this.emit("test-end", test);
    this.emitUpdate();

    if (
      this.failFast &&
      !this.failFastTriggered &&
      test.status === "failed" &&
      !test.def.continueOnError &&
      test.children.length === 0
    ) {
      this.failFastTriggered = true;
      test.output.system("fail-fast: aborting the remaining run");
      this.abort.abort();
    }
  }

  private async runShell(
    test: RunTest,
    scopes: Scopes,
    cwd: string,
    signal: AbortSignal,
  ): Promise<void> {
    if (this.globalSlots) {
      await this.globalSlots.acquire();
      try {
        await this.runShellRetries(test, scopes, cwd, signal);
      } finally {
        this.globalSlots.release();
      }
      return;
    }
    await this.runShellRetries(test, scopes, cwd, signal);
  }

  private async runShellRetries(
    test: RunTest,
    scopes: Scopes,
    cwd: string,
    signal: AbortSignal,
  ): Promise<void> {
    const retry = test.def.retry;
    const attempts = 1 + (typeof retry === "number" ? retry : (retry?.count ?? 0));
    const delayMs = typeof retry === "object" ? parseDurationMs(retry.delay, 0) : 0;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      await this.runShellAttempt(test, scopes, cwd, signal);
      if (test.status !== "failed" || signal.aborted || attempt === attempts) {
        if (test.status === "failed" && attempts > 1 && test.error) {
          test.error = `${test.error} (after ${attempt} attempts)`;
        }
        return;
      }
      test.output.system(
        `attempt ${attempt}/${attempts} failed, retrying${delayMs > 0 ? ` in ${formatMs(delayMs)}` : ""}`,
      );
      test.status = "running";
      this.emitUpdate();
      if (delayMs > 0) await sleep(delayMs, signal);
    }
  }

  private runShellAttempt(
    test: RunTest,
    scopes: Scopes,
    cwd: string,
    signal: AbortSignal,
  ): Promise<void> {
    const where = `test "${test.name}"`;
    const source = test.kind === "script" ? test.def.script! : test.def.command!;
    const resolved = resolveTemplate(source, scopes, where);
    // A custom shell is invoked as <shell...> -c <source>; the default stays
    // sh -c for commands and sh -e -c for scripts.
    const shell = test.def.shell
      ? resolveTemplate(test.def.shell, scopes, where).split(/\s+/)
      : undefined;
    let executable = shell ? shell[0] : "sh";
    let args = shell
      ? [...shell.slice(1), "-c", resolved]
      : test.kind === "script"
        ? ["-e", "-c", resolved]
        : ["-c", resolved];

    // `container` on this test or an ancestor: the same shell invocation
    // runs inside the image instead of on the host.
    const containerDef = this.containerFor(test);
    let spawnCwd = cwd;
    let spawnEnv = scopes.env;
    if (containerDef) {
      const plan = buildTestContainerArgs(
        containerDef,
        cwd,
        this.baseDir,
        scopes.env,
        scopes,
        where,
        [executable, ...args],
      );
      test.output.system(`${plan.engine} run ${containerDef.image} (workdir ${plan.workdir})`);
      executable = plan.engine;
      args = plan.args;
      // the engine itself runs on the host, with the host's own PATH
      spawnCwd = this.baseDir;
      spawnEnv = process.env as Record<string, string>;
    }

    return new Promise((resolve, reject) => {
      const child = spawn(executable, args, {
        cwd: spawnCwd,
        env: spawnEnv,
        detached: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
      child.once("error", reject);
      child.stdout.on("data", (d) => test.output.append(d, "stdout"));
      child.stderr.on("data", (d) => test.output.append(d, "stderr"));

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
        test.output.flush();
        if (signal.aborted) {
          test.status = test.timedOut
            ? "failed"
            : this.interrupted || this.failFastTriggered
              ? "aborted"
              : "failed";
          if (!test.error) test.error = test.timedOut ? "timeout" : "aborted";
        } else if (code === 0) {
          test.status = "passed";
        } else {
          test.status = "failed";
          test.error = sig ? `terminated by ${sig}` : `exit code ${code}`;
          test.output.system(test.error);
        }
        resolve();
      });
    });
  }

  // Runs a setup/teardown hook, streaming into the test's output. Returns
  // whether the hook succeeded. Without a signal the hook cannot be aborted.
  private runHook(
    test: RunTest,
    hook: HookDef,
    label: "setup" | "teardown",
    scopes: Scopes,
    cwd: string,
    signal: AbortSignal | undefined,
  ): Promise<boolean> {
    const where = `${label} of test "${test.name}"`;
    const env = { ...scopes.env, ...resolveEnvMap(hook.env, scopes, where) };
    const hookScopes: Scopes = { ...scopes, env };
    const hookCwd = hook.workdir
      ? resolvePath(cwd, resolveTemplate(hook.workdir, hookScopes, where))
      : cwd;
    const source = hook.script ?? hook.command;
    if (!source) return Promise.resolve(false);
    const resolved = resolveTemplate(source, hookScopes, where);
    test.output.system(`--- ${label} ---`);
    if (signal?.aborted) {
      test.output.system(`${label} not run (aborted)`);
      return Promise.resolve(false);
    }
    return new Promise((resolve) => {
      const child = spawn("sh", hook.script ? ["-e", "-c", resolved] : ["-c", resolved], {
        cwd: hookCwd,
        env,
        detached: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
      child.stdout.on("data", (d) => test.output.append(d, "stdout"));
      child.stderr.on("data", (d) => test.output.append(d, "stderr"));

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
        test.output.flush();
        const ok = code === 0 && !timedOut && !signal?.aborted;
        if (!ok) {
          test.output.system(
            `${label} failed (${timedOut ? "timeout" : (sig ?? `exit code ${code}`)})`,
          );
        }
        resolve(ok);
      });
    });
  }

  private async runSequence(
    test: RunTest,
    scopes: Scopes,
    cwd: string,
    signal: AbortSignal,
  ): Promise<void> {
    let failed = false;
    for (const child of test.children) {
      if (failed || signal.aborted) {
        this.markRemaining(child, signal.aborted && this.interrupted ? "aborted" : "skipped");
        this.emitUpdate();
        continue;
      }
      await this.runTest(child, scopes, cwd, signal);
      if ((child.status === "failed" || child.status === "aborted") && !child.def.continueOnError) {
        failed = true;
      }
    }
  }

  private async runChildrenParallel(
    test: RunTest,
    scopes: Scopes,
    cwd: string,
    signal: AbortSignal,
    maxParallel: number | undefined,
  ): Promise<void> {
    const children = test.children;
    // Matrix instances share their test's def (including any needs meant for
    // the wrapper's siblings), so needs scheduling only applies to real
    // parallel groups.
    const useNeeds = !test.isMatrixWrapper && children.some((child) => child.def.needs?.length);
    if (!useNeeds) {
      let index = 0;
      const workerCount = Math.min(maxParallel ?? children.length, children.length);
      const workers = Array.from({ length: Math.max(1, workerCount) }, async () => {
        while (index < children.length) {
          const child = children[index++];
          await this.runTest(child, scopes, cwd, signal);
        }
      });
      await Promise.all(workers);
      return;
    }

    const byName = new Map(children.map((child) => [child.name, child]));
    const semaphore = new Semaphore(maxParallel ?? children.length);
    const promises = new Map<RunTest, Promise<void>>();
    const runChild = (child: RunTest): Promise<void> => {
      let promise = promises.get(child);
      if (!promise) {
        promise = (async () => {
          // Siblings excluded by filters are treated as satisfied: the user
          // deliberately chose to run a subset.
          const needed = (child.def.needs ?? [])
            .map((name) => byName.get(name))
            .filter((n): n is RunTest => n !== undefined && this.isActive(n));
          await Promise.all(needed.map(runChild));
          // A condition-skip satisfies dependents; a needs-skip or failure
          // cascades down the chain.
          const blocker = needed.find(
            (n) =>
              n.status !== "passed" && !(n.status === "skipped" && n.skipReason === "condition"),
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
            await this.runTest(child, scopes, cwd, signal);
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

  private finishGroup(test: RunTest, signal: AbortSignal): void {
    const failing = test.children.some(
      (child) =>
        (child.status === "failed" || child.status === "aborted") && !child.def.continueOnError,
    );
    const ran = test.children.filter((child) => this.isActive(child));
    if (test.timedOut) test.status = "failed";
    else if (signal.aborted && this.interrupted) test.status = "aborted";
    else if (failing) test.status = "failed";
    else if (ran.length > 0 && ran.every((child) => child.status === "skipped"))
      test.status = "skipped";
    else test.status = "passed";
  }

  private async startServices(
    defs: Record<string, ServiceDef> | undefined,
    scopes: Scopes,
    cwd: string,
    sink: ServiceHandle[],
    controller: AbortController,
    owner = "Testfile",
  ): Promise<void> {
    const entries = Object.entries(defs ?? {});
    if (entries.length === 0) return;
    const byName = new Map(entries);
    // Services without `needs` all start at once; a service that needs
    // others starts only once those are *ready* (their start resolves
    // after the readiness check), so an app can rely on its database.
    const startPromises = new Map<string, Promise<void>>();
    const startService = (name: string, def: ServiceDef): Promise<void> => {
      const running = startPromises.get(name);
      if (running) return running;
      const promise = (async () => {
        const deps = def.needs ?? [];
        if (deps.length > 0) {
          await Promise.all(
            deps.map((dep) => {
              const depDef = byName.get(dep);
              // unknown names are rejected by validation; ignore defensively
              return depDef ? startService(dep, depDef) : Promise.resolve();
            }),
          );
          // a dependency that failed aborts the whole group before we start
          if (controller.signal.aborted) return;
        }
        if (def.shared) {
          await this.acquireShared(name, def, scopes, cwd, sink, controller, owner);
          return;
        }
        const instance = this.registerInstance(name, def, owner);
        // A service dying while its tests run aborts the dependent tests.
        instance.onUnexpectedExit = () => controller.abort();
        sink.push({ instance, release: () => instance.stop().catch(() => {}) });
        this.emitUpdate();
        await instance.start(scopes, cwd, controller.signal);
      })();
      startPromises.set(name, promise);
      return promise;
    };

    const waits = entries.map(([name, def]) => startService(name, def));
    this.emitUpdate();
    await Promise.all(waits);
  }

  // Shared services: one running instance per name + resolved configuration,
  // reference-counted across all tests that declare it.
  private acquireShared(
    name: string,
    def: ServiceDef,
    scopes: Scopes,
    cwd: string,
    sink: ServiceHandle[],
    controller: AbortController,
    owner: string,
  ): Promise<void> {
    const key = `${name} ${sharedServiceKey(def, scopes, cwd)}`;
    let entry = this.sharedPool.get(key);
    if (!entry) {
      const instance = this.registerInstance(name, def, `${owner}, shared`);
      const controllers = new Set<AbortController>();
      instance.onUnexpectedExit = () => {
        for (const c of controllers) c.abort();
      };
      entry = {
        instance,
        refs: 0,
        controllers,
        started: instance.start(scopes, cwd, controller.signal),
      };
      this.sharedPool.set(key, entry);
    }
    const acquired = entry;
    acquired.refs++;
    acquired.controllers.add(controller);
    sink.push({
      instance: acquired.instance,
      release: async () => {
        acquired.controllers.delete(controller);
        acquired.refs--;
        if (acquired.refs === 0) {
          this.sharedPool.delete(key);
          await acquired.instance.stop().catch(() => {});
        }
      },
    });
    return acquired.started;
  }

  private registerInstance(name: string, def: ServiceDef, owner: string): ServiceInstance {
    const instance = new ServiceInstance(name, def);
    instance.owner = owner;
    instance.on("update", () => this.emitUpdate());
    this.services.push(instance);
    this.emit("service-added", instance);
    return instance;
  }

  private async stopServices(started: ServiceHandle[]): Promise<void> {
    for (const handle of [...started].reverse()) {
      await handle.release();
    }
  }

  private emitUpdate(): void {
    this.emit("update");
  }

  // Marks a test and its not-yet-finished active descendants with a final status.
  private markRemaining(test: RunTest, status: Status): void {
    walk(test, (n) => {
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

// A test runs in the nearest `container` declared on itself or an
// ancestor, so a group can give a whole branch one toolchain.
function nearestContainer(test: RunTest): TestContainerDef | undefined {
  for (let node: RunTest | undefined = test; node; node = node.parent) {
    if (node.def.container) return node.def.container;
  }
  return undefined;
}

// Secret variables are taken from the host unless the surrounding
// environment already defines them; their values are registered for
// masking in recorded logs and records.
function collectSecrets(
  names: readonly string[] | undefined,
  inherited: Record<string, string>,
  sink: Set<string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of names ?? []) {
    const value = inherited[name] ?? process.env[name];
    if (value === undefined || value === "") continue;
    out[name] = value;
    sink.add(value);
  }
  return out;
}

// Values a Testfile assigned to a secret name (e.g. env: {TOKEN: ...}).
function registerSecretValues(
  names: readonly string[] | undefined,
  env: Record<string, string>,
  sink: Set<string>,
): void {
  for (const name of names ?? []) {
    const value = env[name];
    if (value) sink.add(value);
  }
}

function withNote(note: string | undefined, reason: string): string {
  return note ? `${note}; ${reason}` : reason;
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
