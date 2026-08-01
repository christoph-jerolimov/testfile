import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { resolve as resolvePath } from "node:path";
import type { ContainerDef, ServiceDef } from "./model.js";
import { OutputBuffer } from "./output.js";
import { waitReady } from "./ready.js";
import { resolveEnvMap, resolveTemplate, type Scopes } from "./template.js";
import { parseDurationMs } from "./util.js";

export type ServiceStatus = "pending" | "starting" | "ready" | "stopping" | "stopped" | "failed";

let cachedEngine: string | undefined;

function detectEngine(): string {
  if (!cachedEngine) {
    for (const candidate of ["podman", "docker"]) {
      const result = spawnSync(candidate, ["--version"], { stdio: "ignore" });
      if (result.status === 0) {
        cachedEngine = candidate;
        break;
      }
    }
    if (!cachedEngine) throw new Error("no container engine found (tried podman, docker)");
  }
  return cachedEngine;
}

function execCapture(
  cmd: string,
  args: string[],
  cwd: string
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
// network reach each other by name.
export function buildContainerRunArgs(
  name: string,
  container: ContainerDef,
  scopes: Scopes,
  where: string
): string[] {
  const args = ["run", "--rm", "-d"];
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
      throw new Error(`failed to create network "${network}": ${(create.stderr || create.stdout).trim()}`);
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
          engine: container.engine,
          ports: (container.ports ?? []).map((p) => resolveTemplate(p, scopes, where)),
          env: resolveEnvMap(container.env, scopes, where),
          volumes: (container.volumes ?? []).map((v) => resolveTemplate(v, scopes, where)),
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
  // Where in the tree the service was declared, for display purposes.
  owner = "";
  // Resolved facts for display: image, port mappings, service-level env.
  details: { image?: string; ports?: string[]; env?: Record<string, string> } = {};
  onUnexpectedExit?: () => void;

  private child?: ChildProcess; // service process, or the log follower for containers
  private containerId?: string;
  private engine?: string;
  private exited = false;
  private stopping = false;
  private env: Record<string, string> = {};
  private cwd = ".";
  // Kept for restarts.
  private startScopes?: Scopes;
  private startCwd?: string;

  constructor(
    readonly name: string,
    readonly def: ServiceDef
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
      if (this.def.container) {
        await this.startContainer(myScopes, where);
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

  private startProcess(scopes: Scopes, where: string): void {
    const source = this.def.script ?? this.def.command;
    if (!source) throw new Error("service has neither command, script nor container");
    const resolved = resolveTemplate(source, scopes, where);
    const child = spawn("sh", this.def.script ? ["-e", "-c", resolved] : ["-c", resolved], {
      cwd: this.cwd,
      env: this.env,
      detached: true, // own process group, so stop() can signal the whole tree
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

  private async startContainer(scopes: Scopes, where: string): Promise<void> {
    const container = this.def.container!;
    const engine =
      container.engine && container.engine !== "auto" ? container.engine : detectEngine();
    if (engine === "kubernetes") {
      throw new Error('engine "kubernetes" is reserved for a future version');
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

  async stop(): Promise<void> {
    if (this.stopping || this.status === "pending" || this.status === "stopped") return;
    this.stopping = true;
    const wasFailed = this.status === "failed";
    if (!wasFailed) this.setStatus("stopping");
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
      if (this.containerId && this.engine) {
        const seconds = Math.max(1, Math.ceil(timeoutMs / 1000));
        await execCapture(this.engine, ["stop", "-t", String(seconds), this.containerId], this.cwd).catch(
          () => {}
        );
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
      if (!wasFailed) this.setStatus("stopped");
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
    if (this.containerId && this.engine) {
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
