import assert from "node:assert/strict";
import { after, test } from "node:test";
import {
  buildKubernetesManifests,
  classifyPodStatus,
  dnsName,
  parsePortForward,
  KubernetesService,
  type KubectlExecResult,
  type KubectlRunner,
  type KubectlStream,
} from "./kubernetes.js";
import { OutputBuffer } from "./output.js";
import {
  configureEngine,
  ServiceInstance,
  setEngineProbeForTests,
  sharedServiceKey,
} from "./services.js";
import type { Scopes } from "./template.js";

const scopes: Scopes = { env: {}, ports: { db: 55432 }, matrix: { postgres: "16" } };
const ids = { pod: "tf-db-abc-1", service: "db", runToken: "abc" };

// --- pure parts -----------------------------------------------------------

test("service and pod names are valid DNS labels whatever the Testfile calls them", () => {
  assert.equal(dnsName("db"), "db");
  assert.equal(dnsName("My Fancy_Service"), "my-fancy-service");
  assert.equal(dnsName("--weird--"), "weird");
  assert.equal(dnsName(""), "svc");
  const long = dnsName("x".repeat(80));
  assert.equal(long.length, 63);
});

test("a port mapping is LOCAL:CONTAINER with plain ports, templates resolved", () => {
  assert.deepEqual(parsePortForward("${{ ports.db }}:5432", scopes, "t"), {
    local: 55432,
    remote: 5432,
  });
  assert.throws(() => parsePortForward("8080", scopes, "t"), /not supported/);
  assert.throws(() => parsePortForward("127.0.0.1:80:80", scopes, "t"), /not supported/);
});

test("a service becomes a pod that is never restarted behind the runner's back", () => {
  const { pod, service, forwards } = buildKubernetesManifests(
    "db",
    {
      image: "docker.io/library/postgres:${{ matrix.postgres }}",
      ports: ["${{ ports.db }}:5432"],
      env: { POSTGRES_PASSWORD: "test" },
      pull: "missing",
      entrypoint: ["docker-entrypoint.sh"],
      command: ["postgres", "-c", "fsync=off"],
    },
    scopes,
    "t",
    ids,
  );
  const spec = (pod as { spec: Record<string, unknown> }).spec;
  assert.equal(spec.restartPolicy, "Never");
  const [container] = spec.containers as Record<string, unknown>[];
  assert.equal(container.image, "docker.io/library/postgres:16");
  assert.equal(container.imagePullPolicy, "IfNotPresent");
  // docker's entrypoint/command become kubernetes' command/args
  assert.deepEqual(container.command, ["docker-entrypoint.sh"]);
  assert.deepEqual(container.args, ["postgres", "-c", "fsync=off"]);
  assert.deepEqual(container.env, [{ name: "POSTGRES_PASSWORD", value: "test" }]);
  assert.deepEqual(container.ports, [{ containerPort: 5432 }]);
  assert.deepEqual(forwards, [{ local: 55432, remote: 5432 }]);
  // the DNS Service carries the plain name and pins this run's pod
  const svc = service as { metadata: { name: string }; spec: Record<string, unknown> };
  assert.equal(svc.metadata.name, "db");
  assert.deepEqual(svc.spec.selector, { "testfile/pod": "tf-db-abc-1" });
  assert.deepEqual(svc.spec.ports, [{ name: "p5432", port: 5432, targetPort: 5432 }]);
});

test("a service without ports gets no DNS Service", () => {
  const { service, forwards } = buildKubernetesManifests(
    "worker",
    { image: "img" },
    scopes,
    "t",
    ids,
  );
  assert.equal(service, undefined);
  assert.deepEqual(forwards, []);
});

test("volumes and network are rejected with a reason, not silently dropped", () => {
  assert.throws(
    () => buildKubernetesManifests("db", { image: "i", volumes: ["./x:/y"] }, scopes, "t", ids),
    /volumes are not supported/,
  );
  assert.throws(
    () => buildKubernetesManifests("db", { image: "i", network: "n" }, scopes, "t", ids),
    /already reach each other by name/,
  );
});

test("pod status boils down to waiting, running or gone", () => {
  assert.deepEqual(classifyPodStatus({ status: { phase: "Pending" } }), { phase: "waiting" });
  assert.deepEqual(classifyPodStatus({ status: { phase: "Running" } }), { phase: "running" });
  const backoff = classifyPodStatus({
    status: {
      phase: "Pending",
      containerStatuses: [
        { state: { waiting: { reason: "ImagePullBackOff", message: "Back-off pulling image" } } },
      ],
    },
  });
  assert.equal(backoff.phase, "waiting");
  assert.match(backoff.reason!, /ImagePullBackOff: Back-off pulling image/);
  assert.ok(!backoff.fatal, "backoff can recover, it is not fatal by itself");
  assert.ok(
    classifyPodStatus({
      status: {
        phase: "Pending",
        containerStatuses: [{ state: { waiting: { reason: "InvalidImageName" } } }],
      },
    }).fatal,
    "a bad image reference can never recover",
  );
  const crashed = classifyPodStatus({
    status: {
      phase: "Failed",
      containerStatuses: [{ state: { terminated: { reason: "Error", exitCode: 1 } } }],
    },
  });
  assert.equal(crashed.phase, "gone");
  assert.match(crashed.reason!, /Error \(exit code 1\)/);
});

test("the shared-service key tells namespaces and contexts apart", () => {
  const base = { container: { image: "img" } };
  const a = sharedServiceKey(base, scopes, "/p");
  const b = sharedServiceKey(
    { container: { ...base.container, namespace: "other" } },
    scopes,
    "/p",
  );
  assert.notEqual(a, b);
});

// --- the runtime against a scripted cluster -------------------------------

// A fake kubectl: exec calls are answered from a script keyed on the
// subcommand, streams are handed back for the test to feed and drop.
class FakeStream implements KubectlStream {
  stdout: Array<(c: string | Buffer) => void> = [];
  stderr: Array<(c: string | Buffer) => void> = [];
  exit: Array<(code: number | null) => void> = [];
  killed = false;
  onStdout(cb: (c: string | Buffer) => void) {
    this.stdout.push(cb);
  }
  onStderr(cb: (c: string | Buffer) => void) {
    this.stderr.push(cb);
  }
  onExit(cb: (code: number | null) => void) {
    this.exit.push(cb);
  }
  kill() {
    this.killed = true;
  }
  emitStdout(text: string) {
    for (const cb of this.stdout) cb(text);
  }
  emitExit(code: number | null) {
    for (const cb of this.exit) cb(code);
  }
}

function podJson(phase: string, extra?: object): KubectlExecResult {
  return { code: 0, stdout: JSON.stringify({ status: { phase, ...extra } }), stderr: "" };
}

class FakeKubectl implements KubectlRunner {
  calls: string[][] = [];
  applied: unknown[] = [];
  logStreams: FakeStream[] = [];
  forwardStreams: FakeStream[] = [];
  // Whether port-forward streams announce their pairs (a healthy kubectl).
  announceForwards = true;
  // Answers for successive `get pod` calls; the last repeats.
  podStates: KubectlExecResult[] = [podJson("Running")];
  // What `get events` reports for the pod.
  events: Array<{ type: string; reason: string; message: string }> = [];
  private podCall = 0;

  async exec(args: string[], input?: string): Promise<KubectlExecResult> {
    this.calls.push(args);
    const verb = args.find((a) => ["apply", "get", "delete"].includes(a));
    if (verb === "apply") {
      this.applied.push(JSON.parse(input ?? "null"));
      return { code: 0, stdout: "applied", stderr: "" };
    }
    if (verb === "get" && args.includes("events")) {
      return { code: 0, stdout: JSON.stringify({ items: this.events }), stderr: "" };
    }
    if (verb === "get") {
      const state = this.podStates[Math.min(this.podCall++, this.podStates.length - 1)];
      return state;
    }
    return { code: 0, stdout: "", stderr: "" };
  }

  stream(args: string[]): KubectlStream {
    const stream = new FakeStream();
    if (args.includes("logs")) this.logStreams.push(stream);
    if (args.includes("port-forward")) {
      this.forwardStreams.push(stream);
      // kubectl announces each live pair on stdout
      const pairs = args.filter((a) => /^\d+:\d+$/.test(a));
      if (this.announceForwards) {
        queueMicrotask(() => {
          for (const pair of pairs) {
            stream.emitStdout(`Forwarding from 127.0.0.1:${pair.replace(":", " -> ")}\n`);
          }
        });
      }
    }
    return stream;
  }
}

function makeService(kubectl: FakeKubectl, overrides: object = {}) {
  const output = new OutputBuffer();
  const deaths: string[] = [];
  const service = new KubernetesService(
    "db",
    { image: "img", ports: ["${{ ports.db }}:5432"], ...overrides },
    {
      output,
      scopes,
      where: "t",
      signal: new AbortController().signal,
      onDeath: () => deaths.push("died"),
      runner: kubectl,
      pollIntervalMs: 5,
      pullBackoffGraceMs: 40,
      startTimeoutMs: 2000,
    },
  );
  return { service, output, deaths };
}

test("start applies the manifests, waits for the pod and brings the forwards up", async () => {
  const kubectl = new FakeKubectl();
  kubectl.podStates = [podJson("Pending"), podJson("Running")];
  const { service, output } = makeService(kubectl);
  await service.start(1);

  const list = kubectl.applied[0] as { kind: string; items: Array<{ kind: string }> };
  assert.equal(list.kind, "List");
  assert.deepEqual(
    list.items.map((i) => i.kind),
    ["Pod", "Service"],
  );
  assert.equal(kubectl.logStreams.length, 1, "log follower attached");
  assert.equal(kubectl.forwardStreams.length, 1, "port-forward running");
  const text = output.lines.map((l) => l.text).join("\n");
  assert.match(text, /running/);
  assert.match(text, /forwarding 127\.0\.0\.1:55432 -> 5432/);

  kubectl.logStreams[0].emitStdout("database system is ready\n");
  assert.match(output.text(), /database system is ready/);
});

test("--context and -n are on every kubectl call when configured", async () => {
  const kubectl = new FakeKubectl();
  const { service } = makeService(kubectl, { context: "kind-test", namespace: "ci" });
  await service.start(1);
  for (const call of kubectl.calls) {
    assert.deepEqual(call.slice(0, 4), ["--context", "kind-test", "-n", "ci"]);
  }
});

test("a pod stuck in ImagePullBackOff fails with the registry's message, fast", async () => {
  const kubectl = new FakeKubectl();
  kubectl.podStates = [
    podJson("Pending", {
      containerStatuses: [
        { state: { waiting: { reason: "ImagePullBackOff", message: "no such image" } } },
      ],
    }),
  ];
  const { service } = makeService(kubectl);
  await assert.rejects(service.start(1), /image pull keeps failing.*no such image/);
});

test("a pod that never runs fails with the cluster's own events in the error", async () => {
  const kubectl = new FakeKubectl();
  kubectl.podStates = [podJson("Pending")];
  kubectl.events = [
    { type: "Normal", reason: "Scheduled", message: "assigned" },
    { type: "Warning", reason: "FailedCreatePodSandBox", message: "runc create failed" },
  ];
  const { service, output } = makeService(kubectl);
  // the start cap, not the backoff grace, is what expires here
  await assert.rejects(
    service.start(1),
    /pod not running after .*FailedCreatePodSandBox: runc create failed/,
  );
  assert.match(output.lines.map((l) => l.text).join("\n"), /FailedCreatePodSandBox/);
});

test("a pod that exits before running fails with its termination detail", async () => {
  const kubectl = new FakeKubectl();
  kubectl.podStates = [
    podJson("Failed", {
      containerStatuses: [{ state: { terminated: { reason: "OOMKilled", exitCode: 137 } } }],
    }),
  ];
  const { service } = makeService(kubectl);
  await assert.rejects(service.start(1), /OOMKilled \(exit code 137\)/);
});

test("a dropped log stream reconnects while the pod still runs, and only then", async () => {
  const kubectl = new FakeKubectl();
  const { service, output, deaths } = makeService(kubectl);
  await service.start(1);

  // drop while running: reconnect with --since-time, service stays alive
  kubectl.logStreams[0].emitExit(1);
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(kubectl.logStreams.length, 2, "follower restarted");
  assert.deepEqual(deaths, []);
  assert.match(output.text("stdout") + output.lines.map((l) => l.text).join("\n"), /reconnecting/);

  // drop after the pod is gone: the service is reported dead
  kubectl.podStates = [podJson("Failed")];
  kubectl.logStreams[1].emitExit(1);
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(deaths, ["died"]);
  assert.equal(service.exited, true);
});

test("a dropped port-forward is restarted so localhost keeps working", async () => {
  const kubectl = new FakeKubectl();
  const { service, output, deaths } = makeService(kubectl);
  await service.start(1);

  kubectl.forwardStreams[0].emitExit(1);
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(kubectl.forwardStreams.length, 2, "forward restarted");
  assert.deepEqual(deaths, []);
  assert.match(output.lines.map((l) => l.text).join("\n"), /port-forward dropped, restarting/);
});

test("a port-forward that cannot start fails the service with kubectl's stderr", async () => {
  const kubectl = new FakeKubectl();
  kubectl.announceForwards = false;
  const brokenStream = kubectl.stream.bind(kubectl);
  kubectl.stream = (args: string[]) => {
    const stream = brokenStream(args) as FakeStream;
    if (args.includes("port-forward")) {
      queueMicrotask(() => {
        for (const cb of stream.stderr) cb("unable to listen on port 55432\n");
        stream.emitExit(1);
      });
    }
    return stream;
  };
  const { service } = makeService(kubectl);
  await assert.rejects(service.start(1), /port-forward failed.*unable to listen/);
});

test("stop deletes the pod and its Service without waiting, with the grace period", async () => {
  const kubectl = new FakeKubectl();
  const { service } = makeService(kubectl);
  await service.start(1);
  await service.stop(7);
  const del = kubectl.calls.find((c) => c.includes("delete"))!;
  assert.ok(del.some((a) => a.startsWith("pod/tf-db-")));
  assert.ok(del.includes("service/db"));
  assert.ok(del.includes("--wait=false"));
  assert.ok(del.includes("--grace-period=7"));
  assert.ok(kubectl.logStreams[0].killed && kubectl.forwardStreams[0].killed);
});

// --- through the real ServiceInstance -------------------------------------
// The engine is the run's choice now, so these runs choose kubernetes the
// way a user would: configuration, not a field in the service.

test("a kubernetes service goes ready through the normal readiness machinery", async () => {
  configureEngine("kubernetes", "test");
  after(() => setEngineProbeForTests());
  const kubectl = new FakeKubectl();
  const instance = new ServiceInstance(
    "db",
    {
      container: { image: "img", ports: ["${{ ports.db }}:5432"] },
      ready: { log: "accepting connections", interval: "10ms", timeout: "2s" },
    },
    kubectl,
  );
  const started = instance.start(
    { env: {}, ports: { db: 55432 }, matrix: {} },
    process.cwd(),
    new AbortController().signal,
  );
  // the log-based readiness check passes on the streamed pod log
  const logAppeared = new Promise<void>((resolve) => {
    const timer = setInterval(() => {
      if (kubectl.logStreams.length > 0) {
        clearInterval(timer);
        kubectl.logStreams[0].emitStdout("database system is accepting connections\n");
        resolve();
      }
    }, 5);
  });
  await logAppeared;
  await started;
  assert.equal(instance.status, "ready");

  await instance.stop();
  assert.equal(instance.status, "stopped");
  assert.ok(kubectl.calls.some((c) => c.includes("delete")));
});

test("a pod that dies while ready fails the instance and aborts dependents", async () => {
  configureEngine("kubernetes", "test");
  after(() => setEngineProbeForTests());
  const kubectl = new FakeKubectl();
  const instance = new ServiceInstance("db", { container: { image: "img" } }, kubectl);
  let aborted = 0;
  instance.onUnexpectedExit = () => aborted++;
  await instance.start(
    { env: {}, ports: {}, matrix: {} },
    process.cwd(),
    new AbortController().signal,
  );
  assert.equal(instance.status, "ready");

  kubectl.podStates = [podJson("Failed")];
  kubectl.logStreams[0].emitExit(1);
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(instance.status, "failed");
  assert.equal(aborted, 1);
});
