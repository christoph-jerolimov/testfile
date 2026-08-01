import assert from "node:assert/strict";
import { test } from "node:test";
import { buildContainerRunArgs } from "./services.js";
import type { Scopes } from "./template.js";

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
