import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { resolve as resolvePath } from "node:path";
import { KubernetesService, type KubectlRunner } from "./kubernetes.js";
import type { ContainerDef, ServiceDef } from "./model.js";
import { OutputBuffer } from "./output.js";
import { EXEC_TIMEOUT_MS, waitReady } from "./ready.js";
import { resolveEnvMap, resolveTemplate, type Scopes } from "./template.js";
import { formatMs, parseDurationMs } from "./util.js";

// "done" is a one-shot service that finished successfully - the counterpart
// of "ready" for something that was never meant to keep running.
export type ServiceStatus =
  | "pending"
  | "starting"
  | "ready"
  | "done"
  | "stopping"
  | "stopped"
  | "failed";

// Which engine runs the containers is decided by whoever runs the tests,
// not by the Testfile: --engine beats TESTFILE_ENGINE beats the first
// engine that actually responds, in this order. "Responds" is stricter
// than "installed" - a docker CLI without its daemon is not available.
export type Engine = "podman" | "docker" | "kubernetes";
export const ENGINES: Engine[] = ["podman", "docker", "kubernetes"];

// An engine answers for its backend, not merely for --version: podman and
// docker via `info`, kubernetes only when kubectl reaches a cluster.
function respond(engine: Engine): boolean {
  const [cmd, args] = engine === "kubernetes" ? ["kubectl", ["cluster-info"]] : [engine, ["info"]];
  return spawnSync(cmd, args, { stdio: "ignore", timeout: 15_000 }).status === 0;
}

let prober: (engine: Engine) => boolean = respond;
let configuredEngine: Engine | undefined;
let detectedEngine: Engine | undefined;

// The run's explicit choice (--engine or TESTFILE_ENGINE); rejects names
// that are not engines so a typo fails the run instead of hiding behind
// auto-detection. Undefined clears the choice.
export function configureEngine(name: string | undefined, origin: string): void {
  if (name === undefined || name === "") {
    configuredEngine = undefined;
    return;
  }
  if (!(ENGINES as string[]).includes(name)) {
    throw new Error(`${origin}: unknown engine "${name}", expected ${ENGINES.join(", ")}`);
  }
  configuredEngine = name as Engine;
}

export function detectEngine(): Engine {
  if (configuredEngine) return configuredEngine;
  if (!detectedEngine) {
    detectedEngine = ENGINES.find(prober);
    if (!detectedEngine) {
      throw new Error(
        "no container engine available (podman and docker do not respond, kubectl reaches no cluster)",
      );
    }
  }
  return detectedEngine;
}

// Test bodies run locally with the project mounted, which kubernetes cannot
// provide - so they use the local engines only. An explicit kubernetes
// choice falls through to whatever local engine is available, the same way
// the docs promise ("a test body container still runs locally").
export function detectLocalEngine(): Engine {
  if (configuredEngine && configuredEngine !== "kubernetes") return configuredEngine;
  const local = (["podman", "docker"] as Engine[]).find(
    (engine) => detectedEngine === engine || prober(engine),
  );
  if (!local) {
    throw new Error("a test body container runs locally and needs podman or docker");
  }
  return local;
}

// Seam for the tests: replace how availability is probed, and forget what
// was detected so far. Called without arguments it restores the real probe.
export function setEngineProbeForTests(probe?: (engine: Engine) => boolean): void {
  prober = probe ?? respond;
  detectedEngine = undefined;
  configuredEngine = undefined;
}

function execCapture(
  cmd: string,
  args: string[],
  cwd: string,
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.once("error", reject);
    child.once("close", (code) => resolve({ code, stdout, stderr }));
  });
}

function waitExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) return resolve(true);
    const timer = setTimeout(() => {
      child.removeListener("exit", onExit);
      resolve(false);
    }, timeoutMs);
    const onExit = () => {
      clearTimeout(timer);
      resolve(true);
    };
    child.once("exit", onExit);
  });
}

// The full `run` argument list for a service container. The service name
// becomes a network alias when a network is set, so services on the same
// network reach each other by name. A one-shot runs in the foreground
// (`detached: false`), so the engine's exit code is the container's.
export function buildContainerRunArgs(
  name: string,
  container: ContainerDef,
  scopes: Scopes,
  where: string,
  opts: { detached?: boolean } = {},
): string[] {
  const args = opts.detached === false ? ["run", "--rm"] : ["run", "--rm", "-d"];
  if (container.pull) args.push(`--pull=${container.pull}`);
  if (container.network) {
    args.push("--network", resolveTemplate(container.network, scopes, where));
    args.push("--network-alias", name);
  }
  for (const mapping of container.ports ?? []) {
    args.push("-p", resolveTemplate(mapping, scopes, where));
  }
  for (const [key, value] of Object.entries(resolveEnvMap(container.env, scopes, where))) {
    args.push("-e", `${key}=${value}`);
  }
  for (const volume of container.volumes ?? []) {
    args.push("-v", resolveTemplate(volume, scopes, where));
  }
  if (container.entrypoint) {
    const entrypoint = container.entrypoint.map((part) => resolveTemplate(part, scopes, where));
    // both engines accept a JSON array for multi-part entrypoints
    args.push("--entrypoint", entrypoint.length === 1 ? entrypoint[0] : JSON.stringify(entrypoint));
  }
  args.push(resolveTemplate(container.image, scopes, where));
  for (const arg of container.command ?? []) {
    args.push(resolveTemplate(arg, scopes, where));
  }
  return args;
}

// Networks created (or verified) in this process, per engine.
const ensuredNetworks = new Set<string>();

async function ensureNetwork(engine: string, network: string, cwd: string): Promise<void> {
  const key = `${engine}:${network}`;
  if (ensuredNetworks.has(key)) return;
  const inspect = await execCapture(engine, ["network", "inspect", network], cwd);
  if (inspect.code !== 0) {
    const create = await execCapture(engine, ["network", "create", network], cwd);
    if (create.code !== 0 && !/already exists/i.test(create.stderr)) {
      throw new Error(
        `failed to create network "${network}": ${(create.stderr || create.stdout).trim()}`,
      );
    }
  }
  ensuredNetworks.add(key);
}

// Identity of a service's fully resolved configuration. Shared services with
// the same name and key reuse one running instance; a config that differs
// (e.g. a matrix variable in the image) yields a different key.
export function sharedServiceKey(def: ServiceDef, scopes: Scopes, cwd: string): string {
  const where = "shared service";
  const opt = (value?: string): string | undefined =>
    value === undefined ? undefined : resolveTemplate(value, scopes, where);
  const container = def.container;
  return JSON.stringify({
    cwd: def.workdir ? resolvePath(cwd, opt(def.workdir)!) : cwd,
    command: opt(def.command),
    script: opt(def.script),
    env: resolveEnvMap(def.env, scopes, where),
    container: container
      ? {
          image: resolveTemplate(container.image, scopes, where),
          context: opt(container.context),
          namespace: opt(container.namespace),
          network: opt(container.network),
          pull: container.pull,
          ports: (container.ports ?? []).map((p) => resolveTemplate(p, scopes, where)),
          env: resolveEnvMap(container.env, scopes, where),
          volumes: (container.volumes ?? []).map((v) => resolveTemplate(v, scopes, where)),
          entrypoint: (container.entrypoint ?? []).map((e) => resolveTemplate(e, scopes, where)),
          command: (container.command ?? []).map((a) => resolveTemplate(a, scopes, where)),
        }
      : undefined,
  });
}

// One running service: a local process or a container. Emits "update" on
// status changes.
export class ServiceInstance extends EventEmitter {
  status: ServiceStatus = "pending";
  readonly output = new OutputBuffer();
  error?: string;
  // Where in the suite the service was declared, for display purposes.
  owner = "";
  // Resolved facts for display: image, port mappings, service-level env.
  details: { image?: string; ports?: string[]; env?: Record<string, string> } = {};
  onUnexpectedExit?: () => void;

  private child?: ChildProcess; // service process, or the log follower for containers
  private containerId?: string;
  private engine?: string;
  private k8s?: KubernetesService;
  private k8sAttempt = 0;
  private exited = false;
  private stopping = false;
  private env: Record<string, string> = {};
  private cwd = ".";
  // Kept for restarts.
  private startScopes?: Scopes;
  private startCwd?: string;

  constructor(
    readonly name: string,
    readonly def: ServiceDef,
    // Test seam for the kubernetes engine; the real runner spawns kubectl.
    private readonly kubectl?: KubectlRunner,
  ) {
    super();
  }

  async start(scopes: Scopes, cwd: string, signal: AbortSignal): Promise<void> {
    this.setStatus("starting");
    this.startScopes = scopes;
    this.startCwd = cwd;
    const where = `service "${this.name}"`;
    const ownEnv = resolveEnvMap(this.def.env, scopes, where);
    const env = { ...scopes.env, ...ownEnv };
    const myScopes: Scopes = { ...scopes, env };
    this.env = env;
    // Readiness log matching starts at the current end of the buffer, so a
    // restart is not satisfied by the previous run's output.
    const logFrom = this.output.lines.length;
    this.details = {
      env: Object.keys(ownEnv).length > 0 ? ownEnv : undefined,
      image: this.def.container
        ? resolveTemplate(this.def.container.image, myScopes, where)
        : undefined,
      ports: this.def.container?.ports?.map((p) => resolveTemplate(p, myScopes, where)),
    };
    this.cwd = this.def.workdir
      ? resolvePath(cwd, resolveTemplate(this.def.workdir, myScopes, where))
      : cwd;
    try {
      if (this.def.oneshot) {
        await this.runOnce(myScopes, where, signal);
        this.setStatus("done");
        return;
      }
      if (this.def.container) {
        await this.startContainer(myScopes, where, signal);
      } else {
        this.startProcess(myScopes, where);
      }
      await waitReady(this.def.ready, {
        output: this.output,
        scopes: myScopes,
        signal,
        where,
        cwd: this.cwd,
        logFrom,
        isRunning: () => !this.exited,
        // A container brings its own client tools; the machine running the
        // tests usually does not. Process services have no inside to run in.
        execInContainer: this.def.container ? (cmd) => this.execInContainer(cmd) : undefined,
      });
      if (this.status === "starting") this.setStatus("ready");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.error = message;
      this.output.system(`failed: ${message}`);
      this.setStatus("failed");
      await this.stop().catch(() => {});
      throw new Error(`${where}: ${message}`);
    }
  }

  // A one-shot service: run the step, wait for it, and let its exit code
  // decide. Nothing is left running afterwards, so there is no readiness
  // check to poll and nothing for stop() to do - whatever needed this one
  // starts because it finished, not because it came up.
  private async runOnce(scopes: Scopes, where: string, signal: AbortSignal): Promise<void> {
    const timeoutMs =
      this.def.timeout !== undefined ? parseDurationMs(this.def.timeout, 0) : undefined;
    const code = this.def.container
      ? await this.runContainerOnce(scopes, where, signal, timeoutMs)
      : await this.runProcessOnce(scopes, where, signal, timeoutMs);
    this.exited = true;
    this.output.flush();
    if (code !== 0) throw new Error(`exited with code ${code}`);
    this.output.system("done");
  }

  // Shared plumbing for both one-shot flavours: stream the child's output
  // into the service log, and resolve with its exit code. An abort or an
  // expired timeout kills the process group and fails the service, because
  // a half-applied step is not something to run tests against.
  private awaitChild(
    child: ChildProcess,
    signal: AbortSignal,
    timeoutMs: number | undefined,
    what: string,
  ): Promise<number | null> {
    this.child = child;
    child.stdout?.on("data", (d) => this.output.append(d, "stdout"));
    child.stderr?.on("data", (d) => this.output.append(d, "stderr"));
    return new Promise((resolve, reject) => {
      const stop = (reason: string) => {
        cleanup();
        this.signalGroup("SIGKILL");
        reject(new Error(reason));
      };
      const onAbort = () => stop(`aborted while running ${what}`);
      const timer =
        timeoutMs !== undefined
          ? setTimeout(
              () => stop(`${what} did not finish within ${formatMs(timeoutMs)}`),
              timeoutMs,
            )
          : undefined;
      const cleanup = () => {
        if (timer) clearTimeout(timer);
        signal.removeEventListener("abort", onAbort);
      };
      if (signal.aborted) return onAbort();
      signal.addEventListener("abort", onAbort, { once: true });
      child.once("error", (err) => {
        cleanup();
        reject(err);
      });
      child.once("close", (code) => {
        cleanup();
        resolve(code);
      });
    });
  }

  private runProcessOnce(
    scopes: Scopes,
    where: string,
    signal: AbortSignal,
    timeoutMs: number | undefined,
  ): Promise<number | null> {
    const source = this.def.script ?? this.def.command;
    if (!source) throw new Error("service has neither command, script nor container");
    const resolved = resolveTemplate(source, scopes, where);
    const child = spawn("sh", this.def.script ? ["-e", "-c", resolved] : ["-c", resolved], {
      cwd: this.cwd,
      env: this.env,
      detached: true, // own process group, so a timeout can take the whole tree
      stdio: ["ignore", "pipe", "pipe"],
    });
    return this.awaitChild(child, signal, timeoutMs, "the step");
  }

  // The container runs in the foreground: no -d, so the engine's own exit
  // code is the container's and no log follower is needed.
  private async runContainerOnce(
    scopes: Scopes,
    where: string,
    signal: AbortSignal,
    timeoutMs: number | undefined,
  ): Promise<number | null> {
    const container = this.def.container!;
    const engine = detectEngine();
    if (engine === "kubernetes") {
      const k8s = this.makeKubernetes(container, scopes, where, signal);
      return k8s.runOnce(this.k8sAttempt, timeoutMs);
    }
    this.engine = engine;
    if (container.network) {
      await ensureNetwork(engine, resolveTemplate(container.network, scopes, where), this.cwd);
    }
    const args = buildContainerRunArgs(this.name, container, scopes, where, { detached: false });
    this.output.system(`${engine} ${args.join(" ")}`);
    const child = spawn(engine, args, {
      cwd: this.cwd,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    return this.awaitChild(child, signal, timeoutMs, "the container");
  }

  // Runs a readiness probe inside this service's container: `<engine> exec`
  // for podman and docker, `kubectl exec` for a pod. A probe that hangs is
  // killed so the poll loop keeps its cadence.
  private execInContainer(command: string): Promise<boolean> {
    if (this.k8s) return this.k8s.exec(command);
    if (!this.engine || !this.containerId) return Promise.resolve(false);
    return new Promise((resolve) => {
      const child = spawn(this.engine!, ["exec", this.containerId!, "sh", "-c", command], {
        cwd: this.cwd,
        stdio: "ignore",
      });
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        resolve(false);
      }, EXEC_TIMEOUT_MS);
      child.once("error", () => {
        clearTimeout(timer);
        resolve(false);
      });
      child.once("close", (code) => {
        clearTimeout(timer);
        resolve(code === 0);
      });
    });
  }

  private startProcess(scopes: Scopes, where: string): void {
    const source = this.def.script ?? this.def.command;
    if (!source) throw new Error("service has neither command, script nor container");
    const resolved = resolveTemplate(source, scopes, where);
    const child = spawn("sh", this.def.script ? ["-e", "-c", resolved] : ["-c", resolved], {
      cwd: this.cwd,
      env: this.env,
      detached: true, // own process group, so stop() can signal the whole suite
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout.on("data", (d) => this.output.append(d, "stdout"));
    child.stderr.on("data", (d) => this.output.append(d, "stderr"));
    child.on("exit", (code, sig) => {
      this.exited = true;
      this.output.flush();
      this.output.system(`process exited (${sig ?? `code ${code}`})`);
      if (this.stopping) {
        return;
      }
      if (this.status === "ready") {
        this.error = `exited unexpectedly (${sig ?? `code ${code}`})`;
        this.setStatus("failed");
        this.onUnexpectedExit?.();
      }
    });
    this.child = child;
  }

  private async startContainer(scopes: Scopes, where: string, signal: AbortSignal): Promise<void> {
    const container = this.def.container!;
    const engine = detectEngine();
    if (engine === "kubernetes") {
      await this.startKubernetes(container, scopes, where, signal);
      return;
    }
    this.engine = engine;

    if (container.network) {
      await ensureNetwork(engine, resolveTemplate(container.network, scopes, where), this.cwd);
    }
    const args = buildContainerRunArgs(this.name, container, scopes, where);

    this.output.system(`${engine} ${args.join(" ")}`);
    const run = await execCapture(engine, args, this.cwd);
    if (run.code !== 0) {
      throw new Error(`${engine} run failed: ${(run.stderr || run.stdout).trim()}`);
    }
    this.containerId = run.stdout.trim().split("\n").pop()!;
    this.output.system(`container ${this.containerId.slice(0, 12)} started`);

    const logs = spawn(engine, ["logs", "-f", this.containerId], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    logs.stdout.on("data", (d) => this.output.append(d, "stdout"));
    logs.stderr.on("data", (d) => this.output.append(d, "stderr"));
    // "logs -f" only ends when the container stops.
    logs.on("exit", () => {
      if (!this.stopping && this.status !== "failed") {
        this.exited = true;
        this.error = "container exited unexpectedly";
        this.setStatus("failed");
        this.onUnexpectedExit?.();
      }
    });
    this.child = logs;
  }

  // Services on a Kubernetes cluster: the pod and its DNS Service are
  // managed by KubernetesService; the declared ports arrive on 127.0.0.1
  // through kubectl port-forward, so readiness checks and tests connect to
  // localhost exactly as with published container ports.
  private async startKubernetes(
    container: ContainerDef,
    scopes: Scopes,
    where: string,
    signal: AbortSignal,
  ): Promise<void> {
    await this.makeKubernetes(container, scopes, where, signal).start(this.k8sAttempt);
  }

  // The pod and its lifecycle, without deciding yet whether it is a running
  // service or a step that has to finish.
  private makeKubernetes(
    container: ContainerDef,
    scopes: Scopes,
    where: string,
    signal: AbortSignal,
  ): KubernetesService {
    this.engine = "kubernetes";
    this.k8sAttempt++;
    this.k8s = new KubernetesService(this.name, container, {
      output: this.output,
      scopes,
      where,
      signal,
      runner: this.kubectl,
      onDeath: () => {
        this.exited = true;
        if (this.stopping) return;
        if (this.status === "ready") {
          this.error = "pod exited unexpectedly";
          this.setStatus("failed");
          this.onUnexpectedExit?.();
        }
      },
    });
    return this.k8s;
  }

  async stop(): Promise<void> {
    if (this.stopping || this.status === "pending" || this.status === "stopped") return;
    this.stopping = true;
    // A finished one-shot has nothing left to stop, and "done" says more in
    // the record than "stopped" would - but its pod is still deleted below.
    const keepStatus = this.status === "failed" || this.status === "done";
    if (!keepStatus) this.setStatus("stopping");
    const stopDef = this.def.stop ?? {};
    const timeoutMs = parseDurationMs(stopDef.timeout, 10_000);
    try {
      if (stopDef.command) {
        const cmd = spawn("sh", ["-c", stopDef.command], {
          cwd: this.cwd,
          env: this.env,
          stdio: ["ignore", "pipe", "pipe"],
        });
        cmd.stdout.on("data", (d) => this.output.append(d, "stdout"));
        cmd.stderr.on("data", (d) => this.output.append(d, "stderr"));
        await waitExit(cmd, timeoutMs);
      }
      if (this.k8s) {
        await this.k8s.stop(Math.max(1, Math.ceil(timeoutMs / 1000)));
      } else if (this.containerId && this.engine) {
        const seconds = Math.max(1, Math.ceil(timeoutMs / 1000));
        await execCapture(
          this.engine,
          ["stop", "-t", String(seconds), this.containerId],
          this.cwd,
        ).catch(() => {});
        this.child?.kill("SIGKILL"); // ends the log follower
      } else if (this.child && !this.exited && !stopDef.command) {
        const signal = (stopDef.signal ?? "SIGTERM") as NodeJS.Signals;
        this.signalGroup(signal);
        if (!(await waitExit(this.child, timeoutMs))) {
          this.output.system(`still running after grace period, sending SIGKILL`);
          this.signalGroup("SIGKILL");
          await waitExit(this.child, 2000);
        }
      } else if (this.child && !this.exited && stopDef.command) {
        // stop.command was supposed to shut it down; escalate if it did not.
        if (!(await waitExit(this.child, timeoutMs))) {
          this.signalGroup("SIGKILL");
          await waitExit(this.child, 2000);
        }
      }
    } finally {
      if (!keepStatus) this.setStatus("stopped");
      this.emit("update");
    }
  }

  // Stops the service and starts it again with the same configuration.
  async restart(): Promise<void> {
    if (!this.startScopes || this.startCwd === undefined) return;
    if (this.status === "starting" || this.status === "stopping") return;
    await this.stop().catch(() => {});
    this.stopping = false;
    this.exited = false;
    this.child = undefined;
    this.containerId = undefined;
    this.k8s = undefined;
    this.error = undefined;
    this.output.system("--- restart ---");
    try {
      await this.start(this.startScopes, this.startCwd, new AbortController().signal);
    } catch {
      // start() already recorded the failure on the instance
    }
  }

  // Last resort: immediate SIGKILL (second Ctrl+C).
  kill(): void {
    this.stopping = true;
    this.signalGroup("SIGKILL");
    if (this.k8s) {
      this.k8s.kill();
    } else if (this.containerId && this.engine) {
      spawnSync(this.engine, ["kill", this.containerId], { stdio: "ignore" });
    }
    this.setStatus("stopped");
  }

  private signalGroup(signal: NodeJS.Signals): void {
    if (!this.child?.pid) return;
    try {
      process.kill(-this.child.pid, signal);
    } catch {
      try {
        this.child.kill(signal);
      } catch {
        // already gone
      }
    }
  }

  private setStatus(status: ServiceStatus): void {
    this.status = status;
    this.emit("update");
  }
}
