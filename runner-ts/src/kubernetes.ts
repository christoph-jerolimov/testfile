// Service containers on a Kubernetes cluster, driven entirely through
// kubectl (whatever cluster the current kubeconfig context points at - a
// remote one or a local kind/minikube).
//
// The shape mirrors what the docker/podman path gives a suite:
//
// - Each service becomes one Pod. `restartPolicy: Never`, because the
//   runner owns the lifecycle: a service that dies must surface as failed,
//   not be resurrected behind the runner's back.
// - Each service with ports also becomes a k8s Service named after it, so
//   sibling services reach it by name over cluster DNS - the same role the
//   network alias plays on a container network. Only the local test process
//   is outside the cluster; `kubectl port-forward` bridges the declared
//   ports to 127.0.0.1, so readiness checks and tests talk to localhost
//   exactly as they would with published container ports.
// - Logs are streamed with `kubectl logs -f` into the same OutputBuffer,
//   which makes `ready.log` work and puts the full log into the run folder.
//
// Stability over speed: pod status is followed while starting so a broken
// image reference fails in seconds with the registry's message instead of
// idling into the readiness timeout, and the two long-running kubectl
// processes (logs, port-forward) are restarted when they drop, because both
// are known to die on harmless network hiccups long before the service does.
import { spawn } from "node:child_process";
import type { ContainerDef } from "./model.js";
import type { OutputBuffer } from "./output.js";
import { EXEC_TIMEOUT_MS } from "./ready.js";
import { resolveEnvMap, resolveTemplate, type Scopes } from "./template.js";
import { sleep } from "./util.js";

// Seam for tests: everything kubectl is behind these two calls, so the
// whole runtime is exercisable without a cluster.
export interface KubectlExecResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

export interface KubectlStream {
  onStdout(cb: (chunk: string | Buffer) => void): void;
  onStderr(cb: (chunk: string | Buffer) => void): void;
  onExit(cb: (code: number | null) => void): void;
  kill(): void;
}

export interface KubectlRunner {
  exec(args: string[], input?: string): Promise<KubectlExecResult>;
  stream(args: string[]): KubectlStream;
}

export function spawnKubectlRunner(): KubectlRunner {
  return {
    exec(args, input) {
      return new Promise((resolve, reject) => {
        const child = spawn("kubectl", args, { stdio: ["pipe", "pipe", "pipe"] });
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (d) => (stdout += d.toString()));
        child.stderr.on("data", (d) => (stderr += d.toString()));
        child.once("error", reject); // kubectl not installed
        child.once("close", (code) => resolve({ code, stdout, stderr }));
        if (input !== undefined) child.stdin.end(input);
        else child.stdin.end();
      });
    },
    stream(args) {
      const child = spawn("kubectl", args, { stdio: ["ignore", "pipe", "pipe"] });
      return {
        onStdout: (cb) => child.stdout.on("data", cb),
        onStderr: (cb) => child.stderr.on("data", cb),
        onExit: (cb) => child.once("close", cb),
        kill: () => {
          try {
            child.kill("SIGKILL");
          } catch {
            // already gone
          }
        },
      };
    },
  };
}

// Kubernetes object names must be DNS-1123 labels; a Testfile service name
// is free-form. The sanitized name is also what sibling services resolve
// over cluster DNS, so it must be deterministic.
export function dnsName(raw: string, max = 63): string {
  const cleaned = raw
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const name = cleaned === "" ? "svc" : cleaned;
  return name.length <= max ? name : name.slice(0, max).replace(/-+$/, "");
}

// A declared port mapping, "local:containerPort" after template resolution.
// The container side is what the Pod and the k8s Service expose; the local
// side is where `kubectl port-forward` makes it reachable for the test.
export interface PortForward {
  local: number;
  remote: number;
}

export function parsePortForward(mapping: string, scopes: Scopes, where: string): PortForward {
  const resolved = resolveTemplate(mapping, scopes, where);
  const match = /^(\d+):(\d+)$/.exec(resolved);
  if (!match) {
    throw new Error(
      `port mapping "${resolved}" is not supported with the kubernetes engine - use "LOCAL:CONTAINER" with plain ports`,
    );
  }
  return { local: Number(match[1]), remote: Number(match[2]) };
}

const PULL_POLICY = { always: "Always", missing: "IfNotPresent", never: "Never" } as const;

export interface KubernetesIds {
  // The Pod's name: unique per start, so a restart never races the previous
  // pod's deletion.
  pod: string;
  // The k8s Service's name (and the DNS name siblings use).
  service: string;
  // Groups everything belonging to one runner process, for the selector.
  runToken: string;
}

export interface KubernetesManifests {
  pod: Record<string, unknown>;
  // Only when the container declares ports; a service nothing connects to
  // needs no DNS entry.
  service?: Record<string, unknown>;
  forwards: PortForward[];
}

// The two objects one service becomes. Everything is labelled, so leftovers
// of a crashed runner are findable: kubectl delete pods,services -l
// app.kubernetes.io/managed-by=testfile
export function buildKubernetesManifests(
  name: string,
  container: ContainerDef,
  scopes: Scopes,
  where: string,
  ids: KubernetesIds,
): KubernetesManifests {
  if (container.volumes?.length) {
    throw new Error(
      "volumes are not supported with the kubernetes engine - host paths mean nothing on a cluster",
    );
  }
  if (container.network) {
    throw new Error(
      "network is not supported with the kubernetes engine - services in the same namespace already reach each other by name",
    );
  }

  const labels = {
    "app.kubernetes.io/managed-by": "testfile",
    "testfile/run": ids.runToken,
    "testfile/service": ids.service,
    "testfile/pod": ids.pod,
  };
  const forwards = (container.ports ?? []).map((m) => parsePortForward(m, scopes, where));
  const env = Object.entries(resolveEnvMap(container.env, scopes, where)).map(([k, v]) => ({
    name: k,
    value: v,
  }));

  const pod = {
    apiVersion: "v1",
    kind: "Pod",
    metadata: { name: ids.pod, labels },
    spec: {
      restartPolicy: "Never",
      containers: [
        {
          name: ids.service,
          image: resolveTemplate(container.image, scopes, where),
          ...(container.pull ? { imagePullPolicy: PULL_POLICY[container.pull] } : {}),
          ...(env.length > 0 ? { env } : {}),
          ...(forwards.length > 0
            ? { ports: forwards.map((f) => ({ containerPort: f.remote })) }
            : {}),
          // k8s naming flips docker's: entrypoint is `command`, command is `args`
          ...(container.entrypoint
            ? { command: container.entrypoint.map((p) => resolveTemplate(p, scopes, where)) }
            : {}),
          ...(container.command
            ? { args: container.command.map((a) => resolveTemplate(a, scopes, where)) }
            : {}),
        },
      ],
    },
  };

  const service =
    forwards.length > 0
      ? {
          apiVersion: "v1",
          kind: "Service",
          metadata: { name: ids.service, labels },
          spec: {
            // The selector pins this run's pod: a restart re-applies the
            // Service, so DNS follows the newest pod.
            selector: { "testfile/pod": ids.pod },
            ports: forwards.map((f) => ({
              name: `p${f.remote}`,
              port: f.remote,
              targetPort: f.remote,
            })),
          },
        }
      : undefined;

  return { pod, ...(service ? { service } : {}), forwards };
}

// What the poll loop needs to know about a pod, boiled down from
// `kubectl get pod -o json`.
export interface PodState {
  phase: "waiting" | "running" | "gone";
  // The container's waiting reason (ImagePullBackOff, ...) or termination
  // detail, with the message when the cluster provides one.
  reason?: string;
  // Waiting reasons that can never recover on their own.
  fatal?: boolean;
  // What the container exited with, when the cluster says - the verdict for
  // a one-shot pod. Absent when it ended without a container status.
  exitCode?: number;
}

const FATAL_WAITING = new Set(["InvalidImageName", "ErrImageNeverPull", "CreateContainerError"]);

export function classifyPodStatus(pod: unknown): PodState {
  const status = (pod as { status?: Record<string, unknown> })?.status ?? {};
  const phase = String(status.phase ?? "Pending");
  const containers = (status.containerStatuses ?? []) as Array<{
    state?: {
      waiting?: { reason?: string; message?: string };
      terminated?: { reason?: string; exitCode?: number };
    };
    ready?: boolean;
  }>;
  const waiting = containers[0]?.state?.waiting;
  const terminated = containers[0]?.state?.terminated;

  if (phase === "Succeeded" || phase === "Failed" || terminated) {
    const detail = terminated
      ? `${terminated.reason ?? "terminated"} (exit code ${terminated.exitCode ?? "?"})`
      : phase;
    // A pod without a container status still says how it went by its phase.
    const exitCode = terminated?.exitCode ?? (phase === "Succeeded" ? 0 : undefined);
    return { phase: "gone", reason: detail, ...(exitCode !== undefined ? { exitCode } : {}) };
  }
  if (phase === "Running") return { phase: "running" };
  if (waiting?.reason) {
    const message = waiting.message ? `: ${waiting.message}` : "";
    return {
      phase: "waiting",
      reason: `${waiting.reason}${message}`,
      fatal: FATAL_WAITING.has(waiting.reason),
    };
  }
  return { phase: "waiting" };
}

// How long a pod may sit in ImagePullBackOff before that counts as failed.
// Long enough for a throttled registry to recover, short enough that a
// typo'd image does not idle away the whole start budget.
const PULL_BACKOFF_GRACE_MS = 30_000;
// Overall cap on waiting for the pod to run (scheduling plus image pull) -
// a hang stopper, not a tuning knob; readiness has its own timeout after.
const START_TIMEOUT_MS = 300_000;
// Streams are restarted when they drop; a stream that keeps dropping is a
// real problem and must not retry forever.
const MAX_STREAM_RESTARTS = 10;

export interface KubernetesServiceOptions {
  output: OutputBuffer;
  scopes: Scopes;
  where: string;
  signal: AbortSignal;
  // Called when the pod dies while the service was believed ready.
  onDeath: () => void;
  runner?: KubectlRunner;
  pollIntervalMs?: number;
  pullBackoffGraceMs?: number;
  startTimeoutMs?: number;
}

// One service running as a pod. Owns the kubectl side processes (log
// follower, port-forward) and the pod's lifecycle.
export class KubernetesService {
  private readonly runner: KubectlRunner;
  private readonly base: string[]; // --context/-n, on every kubectl call
  private readonly output: OutputBuffer;
  private readonly onDeath: () => void;
  private readonly pollIntervalMs: number;
  private readonly pullBackoffGraceMs: number;
  private readonly startTimeoutMs: number;

  private ids!: KubernetesIds;
  private forwards: PortForward[] = [];
  private logStream?: KubectlStream;
  private forwardStream?: KubectlStream;
  private logRestarts = 0;
  private forwardRestarts = 0;
  private lastLogAt?: Date;
  private stopping = false;
  private dead = false;

  constructor(
    private readonly name: string,
    private readonly container: ContainerDef,
    private readonly opts: KubernetesServiceOptions,
  ) {
    this.runner = opts.runner ?? spawnKubectlRunner();
    this.output = opts.output;
    this.onDeath = opts.onDeath;
    this.pollIntervalMs = opts.pollIntervalMs ?? 1000;
    this.pullBackoffGraceMs = opts.pullBackoffGraceMs ?? PULL_BACKOFF_GRACE_MS;
    this.startTimeoutMs = opts.startTimeoutMs ?? START_TIMEOUT_MS;
    const where = opts.where;
    this.base = [];
    if (container.context) {
      this.base.push("--context", resolveTemplate(container.context, opts.scopes, where));
    }
    if (container.namespace) {
      this.base.push("-n", resolveTemplate(container.namespace, opts.scopes, where));
    }
  }

  get exited(): boolean {
    return this.dead;
  }

  // Applies the manifests, follows the pod until it runs, then attaches the
  // log stream and the port-forwards. When this resolves, localhost ports
  // are live and readiness checks can start.
  async start(attempt: number): Promise<void> {
    await this.apply(attempt);
    await this.waitForRunning(this.opts.signal);
    this.startLogStream();
    if (this.forwards.length > 0) await this.startPortForward(this.opts.signal);
  }

  // A one-shot pod: nothing waits for it to be Running, because a short step
  // can be Succeeded before the first poll. Its log is collected in one call
  // once it terminated rather than followed - `kubectl logs -f` against a
  // pod that is still being scheduled fails, and a step's output is worth
  // having complete rather than early.
  async runOnce(attempt: number, timeoutMs?: number): Promise<number> {
    await this.apply(attempt);
    try {
      return await this.waitForCompletion(this.opts.signal, timeoutMs);
    } finally {
      await this.collectLogs();
    }
  }

  // Names the objects, builds them and applies them. Shared by both paths.
  private async apply(attempt: number): Promise<void> {
    const { scopes, where } = this.opts;
    const serviceName = dnsName(this.name);
    // The attempt suffix keeps a restart's pod name away from the previous
    // pod, which may still be terminating (deletes do not wait).
    const runToken = `${Date.now().toString(36)}${Math.floor(Math.random() * 36 ** 4)
      .toString(36)
      .padStart(4, "0")}`;
    this.ids = {
      service: serviceName,
      pod: dnsName(`tf-${serviceName}-${runToken}-${attempt}`),
      runToken,
    };

    const manifests = buildKubernetesManifests(this.name, this.container, scopes, where, this.ids);
    this.forwards = manifests.forwards;

    const objects = [manifests.pod, ...(manifests.service ? [manifests.service] : [])];
    const list = { apiVersion: "v1", kind: "List", items: objects };
    this.output.system(
      `kubectl ${[...this.base, "apply"].join(" ")} (pod/${this.ids.pod}${
        manifests.service ? `, service/${this.ids.service}` : ""
      })`,
    );
    const applied = await this.runner.exec(
      [...this.base, "apply", "-f", "-"],
      JSON.stringify(list),
    );
    if (applied.code !== 0) {
      throw new Error(`kubectl apply failed: ${(applied.stderr || applied.stdout).trim()}`);
    }
  }

  // Follows a one-shot pod to termination and reports its exit code. A pod
  // that cannot start (a bad image) fails here with the cluster's reason
  // rather than waiting out the timeout.
  private async waitForCompletion(signal: AbortSignal, timeoutMs?: number): Promise<number> {
    const deadline = timeoutMs === undefined ? undefined : Date.now() + timeoutMs;
    let backoffSince: number | undefined;
    let lastReason: string | undefined;
    for (;;) {
      if (signal.aborted) throw new Error("aborted while the step was running");
      const got = await this.runner.exec([...this.base, "get", "pod", this.ids.pod, "-o", "json"]);
      if (got.code !== 0) {
        throw new Error(`kubectl get pod failed: ${(got.stderr || got.stdout).trim()}`);
      }
      const state = classifyPodStatus(JSON.parse(got.stdout));
      if (state.phase === "gone") {
        this.dead = true;
        // A pod can be gone without the cluster attributing an exit code
        // (evicted, node lost); that is a failure, not a silent success.
        return state.exitCode ?? 1;
      }
      if (state.fatal) await this.failStart(`pod cannot start: ${state.reason}`);
      if (state.reason && state.reason !== lastReason) {
        this.output.system(`pod ${this.ids.pod}: ${state.reason}`);
        lastReason = state.reason;
      }
      if (state.reason?.startsWith("ImagePullBackOff")) {
        backoffSince ??= Date.now();
        if (Date.now() - backoffSince >= this.pullBackoffGraceMs) {
          await this.failStart(`image pull keeps failing: ${state.reason}`);
        }
      } else {
        backoffSince = undefined;
      }
      if (deadline !== undefined && Date.now() >= deadline) {
        throw new Error(`the step did not finish within ${Math.round(timeoutMs! / 1000)}s`);
      }
      await sleep(this.pollIntervalMs, signal);
    }
  }

  // The whole log of a terminated pod, in one call.
  private async collectLogs(): Promise<void> {
    if (!this.ids) return;
    const got = await this.runner.exec([...this.base, "logs", this.ids.pod]).catch(() => undefined);
    if (got?.stdout) this.output.append(got.stdout, "stdout");
    if (got?.stderr) this.output.append(got.stderr, "stderr");
  }

  // The pod's recent warning events - where the cluster explains problems
  // that never make it into the container status (failed sandbox creation,
  // scheduling trouble). Fetched when starting fails, so the error carries
  // the cluster's own words.
  private async podEvents(): Promise<string[]> {
    const got = await this.runner
      .exec([
        ...this.base,
        "get",
        "events",
        "--field-selector",
        `involvedObject.name=${this.ids.pod}`,
        "-o",
        "json",
      ])
      .catch(() => undefined);
    if (!got || got.code !== 0) return [];
    try {
      const items = (JSON.parse(got.stdout).items ?? []) as Array<{
        type?: string;
        reason?: string;
        message?: string;
      }>;
      return items
        .filter((e) => e.type === "Warning" && e.message)
        .slice(-3)
        .map((e) => `${e.reason}: ${e.message}`);
    } catch {
      return [];
    }
  }

  private async failStart(summary: string): Promise<never> {
    const events = await this.podEvents();
    for (const event of events) this.output.system(event);
    const detail = events.length > 0 ? ` (${events[events.length - 1]})` : "";
    throw new Error(`${summary}${detail}`);
  }

  // Follows the pod until it reaches Running. Fails fast with the cluster's
  // own reason when the pod can never get there.
  private async waitForRunning(signal: AbortSignal): Promise<void> {
    const deadline = Date.now() + this.startTimeoutMs;
    let backoffSince: number | undefined;
    let lastReason: string | undefined;
    let lastHeartbeat = Date.now();
    for (;;) {
      if (signal.aborted) throw new Error("aborted while starting the pod");
      const got = await this.runner.exec([...this.base, "get", "pod", this.ids.pod, "-o", "json"]);
      if (got.code !== 0) {
        throw new Error(`kubectl get pod failed: ${(got.stderr || got.stdout).trim()}`);
      }
      const state = classifyPodStatus(JSON.parse(got.stdout));
      if (state.phase === "running") {
        this.output.system(`pod ${this.ids.pod} running`);
        return;
      }
      if (state.phase === "gone") {
        await this.failStart(`pod exited before becoming ready: ${state.reason}`);
      }
      if (state.fatal) {
        await this.failStart(`pod cannot start: ${state.reason}`);
      }
      if (state.reason !== lastReason && state.reason) {
        this.output.system(`pod ${this.ids.pod}: ${state.reason}`);
        lastReason = state.reason;
        lastHeartbeat = Date.now();
      } else if (Date.now() - lastHeartbeat >= 10_000) {
        // A silent wait reads like a hang; say that the pod is the holdup.
        this.output.system(`still waiting for pod ${this.ids.pod} (${state.reason ?? "Pending"})`);
        lastHeartbeat = Date.now();
      }
      if (state.reason?.startsWith("ImagePullBackOff")) {
        backoffSince ??= Date.now();
        if (Date.now() - backoffSince >= this.pullBackoffGraceMs) {
          await this.failStart(`image pull keeps failing: ${state.reason}`);
        }
      } else {
        backoffSince = undefined;
      }
      if (Date.now() >= deadline) {
        await this.failStart(
          `pod not running after ${Math.round(this.startTimeoutMs / 1000)}s (${
            state.reason ?? "still waiting"
          })`,
        );
      }
      await sleep(this.pollIntervalMs, signal);
    }
  }

  // `kubectl logs -f` into the OutputBuffer. The follower is restarted when
  // it drops while the pod is still running (log streams die on network
  // hiccups); when the pod is actually gone, the service is reported dead.
  private startLogStream(sinceTime?: Date): void {
    const args = [...this.base, "logs", "-f", this.ids.pod];
    if (sinceTime) args.push(`--since-time=${sinceTime.toISOString()}`);
    const stream = this.runner.stream(args);
    this.logStream = stream;
    stream.onStdout((chunk) => {
      this.lastLogAt = new Date();
      this.output.append(chunk, "stdout");
    });
    stream.onStderr((chunk) => this.output.append(chunk, "stderr"));
    stream.onExit(() => {
      if (this.stopping || this.dead) return;
      void this.handleLogStreamExit();
    });
  }

  private async handleLogStreamExit(): Promise<void> {
    const got = await this.runner
      .exec([...this.base, "get", "pod", this.ids.pod, "-o", "json"])
      .catch(() => undefined);
    if (this.stopping || this.dead) return;
    const state = got && got.code === 0 ? classifyPodStatus(JSON.parse(got.stdout)) : undefined;
    if (state?.phase === "running" && this.logRestarts < MAX_STREAM_RESTARTS) {
      this.logRestarts++;
      this.output.system("log stream dropped, reconnecting");
      // --since-time picks up where the stream broke; the overlap of one
      // second is deliberate - a duplicated line beats a swallowed one.
      this.startLogStream(this.lastLogAt);
      return;
    }
    this.dead = true;
    this.output.flush();
    this.output.system(
      state ? `pod is gone (${state.reason ?? state.phase})` : "pod state unknown, giving up",
    );
    this.onDeath();
  }

  // One port-forward process for all declared ports. Resolves when kubectl
  // reports every forward as live, so callers can rely on localhost.
  private async startPortForward(signal: AbortSignal): Promise<void> {
    const pairs = this.forwards.map((f) => `${f.local}:${f.remote}`);
    const args = [
      ...this.base,
      "port-forward",
      `pod/${this.ids.pod}`,
      ...pairs,
      "--address",
      "127.0.0.1",
    ];
    await new Promise<void>((resolve, reject) => {
      let live = 0;
      let settled = false;
      let stderr = "";
      const stream = this.runner.stream(args);
      this.forwardStream = stream;
      const abort = () => {
        if (!settled) {
          settled = true;
          stream.kill();
          reject(new Error("aborted while starting port-forward"));
        }
      };
      if (signal.aborted) return abort();
      signal.addEventListener("abort", abort, { once: true });
      stream.onStdout((chunk) => {
        // one "Forwarding from 127.0.0.1:local -> remote" line per pair
        live += (chunk.toString().match(/Forwarding from /g) ?? []).length;
        if (!settled && live >= pairs.length) {
          settled = true;
          signal.removeEventListener("abort", abort);
          for (const f of this.forwards) {
            this.output.system(`forwarding 127.0.0.1:${f.local} -> ${f.remote}`);
          }
          resolve();
        }
      });
      stream.onStderr((chunk) => (stderr += chunk.toString()));
      stream.onExit(() => {
        if (!settled) {
          settled = true;
          signal.removeEventListener("abort", abort);
          reject(new Error(`port-forward failed: ${stderr.trim() || "exited"}`));
          return;
        }
        if (this.stopping || this.dead) return;
        // A dropped forward strands every localhost connection the tests
        // are about to make - restart it rather than letting them time out.
        if (this.forwardRestarts < MAX_STREAM_RESTARTS) {
          this.forwardRestarts++;
          this.output.system("port-forward dropped, restarting");
          void this.startPortForward(new AbortController().signal).catch((err) => {
            this.dead = true;
            this.output.system(`port-forward could not be restarted: ${err.message}`);
            this.onDeath();
          });
        } else {
          this.dead = true;
          this.output.system("port-forward keeps dropping, giving up");
          this.onDeath();
        }
      });
    });
  }

  // Runs a readiness probe inside the pod's container. Streamed rather than
  // captured, because a probe that hangs has to be killable - the poll loop
  // gives up on this attempt and tries again next interval.
  exec(command: string, timeoutMs = EXEC_TIMEOUT_MS): Promise<boolean> {
    if (!this.ids || this.stopping || this.dead) return Promise.resolve(false);
    const stream = this.runner.stream([
      ...this.base,
      "exec",
      this.ids.pod,
      "--",
      "sh",
      "-c",
      command,
    ]);
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        stream.kill();
        resolve(false);
      }, timeoutMs);
      stream.onExit((code) => {
        clearTimeout(timer);
        resolve(code === 0);
      });
    });
  }

  // Deletes the pod and its Service. Deletion is not waited on - the grace
  // period runs inside the cluster, and the next run's names never collide
  // with a terminating pod.
  async stop(graceSeconds: number): Promise<void> {
    this.stopping = true;
    this.forwardStream?.kill();
    this.logStream?.kill();
    if (!this.ids) return;
    const targets = [
      `pod/${this.ids.pod}`,
      ...(this.forwards.length > 0 ? [`service/${this.ids.service}`] : []),
    ];
    await this.runner
      .exec([
        ...this.base,
        "delete",
        ...targets,
        "--ignore-not-found",
        "--wait=false",
        `--grace-period=${graceSeconds}`,
      ])
      .catch(() => {});
  }

  // Immediate teardown (second Ctrl+C): no grace, no waiting.
  kill(): void {
    this.stopping = true;
    this.forwardStream?.kill();
    this.logStream?.kill();
    if (!this.ids) return;
    void this.runner
      .exec([
        ...this.base,
        "delete",
        `pod/${this.ids.pod}`,
        `service/${this.ids.service}`,
        "--ignore-not-found",
        "--wait=false",
        "--force",
        "--grace-period=0",
      ])
      .catch(() => {});
  }
}
