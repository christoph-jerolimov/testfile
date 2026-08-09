import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  buildContainerRunArgs,
  configureEngine,
  detectEngine,
  detectLocalEngine,
  ServiceInstance,
  setEngineProbeForTests,
} from "./services.js";
import { Session } from "./session.js";
import type { Scopes } from "./template.js";

function processEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
  return env;
}

test("a process service can be restarted with its original configuration", async () => {
  const instance = new ServiceInstance("svc", {
    script: "echo up\nsleep 30",
    env: { GREETING: "hi" },
    ready: { log: "up", interval: "100ms", timeout: "5s" },
  });
  const scopes: Scopes = { env: processEnv(), ports: {}, matrix: {} };
  await instance.start(scopes, process.cwd(), new AbortController().signal);
  assert.equal(instance.status, "ready");
  assert.deepEqual(instance.details.env, { GREETING: "hi" });

  await instance.restart();
  assert.equal(instance.status, "ready", "ready again after restart");
  const ups = instance.output.lines.filter((l) => l.text === "up").length;
  assert.equal(ups, 2, "the service actually ran twice");
  assert.ok(instance.output.lines.some((l) => l.text === "--- restart ---"));

  await instance.stop();
  assert.equal(instance.status, "stopped");
});

const scopes: Scopes = {
  env: {},
  ports: { db: 55432 },
  matrix: { postgres: "16" },
};

test("buildContainerRunArgs assembles ports, env, volumes and image with templates", () => {
  const args = buildContainerRunArgs(
    "postgres",
    {
      image: "docker.io/library/postgres:${{ matrix.postgres }}",
      ports: ["${{ ports.db }}:5432"],
      env: { POSTGRES_PASSWORD: "test" },
      volumes: ["./fixtures:/docker-entrypoint-initdb.d:ro"],
    },
    scopes,
    "t",
  );
  assert.deepEqual(args, [
    "run",
    "--rm",
    "-d",
    "-p",
    "55432:5432",
    "-e",
    "POSTGRES_PASSWORD=test",
    "-v",
    "./fixtures:/docker-entrypoint-initdb.d:ro",
    "docker.io/library/postgres:16",
  ]);
});

test("pull policy, network with alias, entrypoint and command overrides", () => {
  const args = buildContainerRunArgs(
    "app",
    {
      image: "ghcr.io/example/app:latest",
      pull: "always",
      network: "testnet",
      entrypoint: ["/bin/sh", "-c"],
      command: ["./start.sh"],
    },
    scopes,
    "t",
  );
  assert.deepEqual(args, [
    "run",
    "--rm",
    "-d",
    "--pull=always",
    "--network",
    "testnet",
    "--network-alias",
    "app",
    "--entrypoint",
    '["/bin/sh","-c"]',
    "ghcr.io/example/app:latest",
    "./start.sh",
  ]);
});

test("a single-part entrypoint is passed plainly", () => {
  const args = buildContainerRunArgs("tool", { image: "img", entrypoint: ["/entry"] }, scopes, "t");
  assert.deepEqual(args.slice(-3), ["--entrypoint", "/entry", "img"]);
});

test("a service with needs starts only after its dependency is ready", async () => {
  const dir = mkdtempSync(join(tmpdir(), "testfile-svc-needs-"));
  process.on("exit", () => rmSync(dir, { recursive: true, force: true }));
  const session = new Session(
    {
      version: 0,
      services: {
        db: {
          // "ready" only after a moment, so a racing app would win
          script: 'sleep 0.4; echo db-ready; echo db >> "$ORDER"; sleep 30',
          ready: { log: "db-ready", timeout: "10s" },
        },
        app: {
          needs: ["db"],
          script: 'echo app-ready; echo app >> "$ORDER"; sleep 30',
          ready: { log: "app-ready", timeout: "10s" },
        },
      },
      env: { ORDER: join(dir, "order.txt") },
      test: { name: "root", command: "true" },
    },
    dir,
  );
  assert.equal(await session.runAll(), "passed");
  assert.deepEqual(
    readFileSync(join(dir, "order.txt"), "utf8").trim().split("\n"),
    ["db", "app"],
    "app waited for the database to report ready",
  );
});

test("service needs are validated: unknown names and cycles", () => {
  assert.throws(
    () =>
      new Session(
        {
          version: 0,
          services: { app: { needs: ["nope"], command: "true", ready: { log: "x" } } },
          test: { name: "root", command: "true" },
        },
        ".",
      ),
    /needs unknown service "nope"/,
  );
  assert.throws(
    () =>
      new Session(
        {
          version: 0,
          services: {
            a: { needs: ["b"], command: "true", ready: { log: "x" } },
            b: { needs: ["a"], command: "true", ready: { log: "x" } },
          },
          test: { name: "root", command: "true" },
        },
        ".",
      ),
    /cyclic service needs/,
  );
});

// --- engine selection ------------------------------------------------------
// The engine is chosen by whoever runs the tests: --engine beats
// TESTFILE_ENGINE beats the first responding engine, in podman, docker,
// kubernetes order. Probing is injected here, so no engine needs to exist.

test("detection walks podman, docker, kubernetes and takes the first that responds", () => {
  try {
    setEngineProbeForTests(() => true);
    assert.equal(detectEngine(), "podman");
    setEngineProbeForTests((engine) => engine !== "podman");
    assert.equal(detectEngine(), "docker");
    setEngineProbeForTests((engine) => engine === "kubernetes");
    assert.equal(detectEngine(), "kubernetes");
    setEngineProbeForTests(() => false);
    assert.throws(() => detectEngine(), /no container engine available/);
  } finally {
    setEngineProbeForTests();
  }
});

test("the detected engine is remembered for the rest of the run", () => {
  try {
    let probes = 0;
    setEngineProbeForTests(() => {
      probes++;
      return true;
    });
    detectEngine();
    detectEngine();
    assert.equal(probes, 1, "one probe answers every later call");
  } finally {
    setEngineProbeForTests();
  }
});

test("a configured engine wins without probing anything", () => {
  try {
    setEngineProbeForTests(() => assert.fail("an explicit choice must not probe"));
    configureEngine("docker", "--engine");
    assert.equal(detectEngine(), "docker");
  } finally {
    setEngineProbeForTests();
  }
});

test("a typo in the engine name fails the run instead of hiding behind detection", () => {
  try {
    assert.throws(
      () => configureEngine("dokcer", "TESTFILE_ENGINE"),
      /TESTFILE_ENGINE: unknown engine "dokcer", expected podman, docker, kubernetes/,
    );
  } finally {
    setEngineProbeForTests();
  }
});

test("test bodies use a local engine even when the run picked kubernetes", () => {
  try {
    // explicit kubernetes: the body falls through to the local chain
    setEngineProbeForTests((engine) => engine === "docker");
    configureEngine("kubernetes", "--engine");
    assert.equal(detectEngine(), "kubernetes");
    assert.equal(detectLocalEngine(), "docker");
    // nothing local at all: the body cannot run, with a reason
    setEngineProbeForTests((engine) => engine === "kubernetes");
    configureEngine("kubernetes", "--engine");
    assert.throws(() => detectLocalEngine(), /runs locally and needs podman or docker/);
  } finally {
    setEngineProbeForTests();
  }
});
