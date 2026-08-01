import assert from "node:assert/strict";
import { test } from "node:test";
import { buildContainerRunArgs, ServiceInstance } from "./services.js";
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
    "t"
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
    "t"
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
  const args = buildContainerRunArgs(
    "tool",
    { image: "img", entrypoint: ["/entry"] },
    scopes,
    "t"
  );
  assert.deepEqual(args.slice(-3), ["--entrypoint", "/entry", "img"]);
});
