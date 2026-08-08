import assert from "node:assert/strict";
import { resolve } from "node:path";
import { test } from "node:test";
import { buildTestContainerArgs, DEFAULT_WORKDIR } from "./testcontainer.js";
import type { Scopes } from "./template.js";

const scopes: Scopes = { env: {}, ports: { web: 5001 }, matrix: {} };

// The mount source is a host path, so it is whatever the platform makes of
// "/proj" - "/proj" on Linux and macOS, "D:\proj" on the Windows runner.
const PROJECT = resolve("/proj");

// The engine is named rather than detected: these tests are about the
// arguments, and they must pass on a machine without podman or docker.
function plan(def: Parameters<typeof buildTestContainerArgs>[0], hostCwd = PROJECT, env = {}) {
  return buildTestContainerArgs(
    def,
    hostCwd,
    PROJECT,
    env,
    scopes,
    'test "x"',
    ["sh", "-c", "npm test"],
    () => "docker",
  );
}

test("without an engine the detected one is used", () => {
  assert.equal(plan({ image: "node:22" }).engine, "docker");
  assert.equal(plan({ image: "node:22", engine: "auto" }).engine, "docker");
  assert.equal(plan({ image: "node:22", engine: "podman" }).engine, "podman");
});

test("the project is mounted and the shell runs inside the image", () => {
  const result = plan({ image: "golang:1.23", engine: "docker" });
  assert.equal(result.engine, "docker");
  assert.equal(result.workdir, DEFAULT_WORKDIR);
  const args = result.args.join(" ");
  assert.match(args, /^run --rm -i /);
  assert.match(args, /--network host/, "host networking keeps services reachable");
  assert.ok(args.includes(`-v ${PROJECT}:${DEFAULT_WORKDIR}`));
  assert.match(args, new RegExp(`-w ${DEFAULT_WORKDIR}`));
  assert.match(args, /--entrypoint sh golang:1\.23 -c npm test$/);
});

test("a nested working directory maps into the mount", () => {
  const result = plan({ image: "node:22" }, resolve(PROJECT, "packages/api"));
  assert.equal(result.workdir, `${DEFAULT_WORKDIR}/packages/api`);
  assert.ok(result.args.includes(`${DEFAULT_WORKDIR}/packages/api`));
});

test("the test environment is passed through, host-specific variables are not", () => {
  const result = plan({ image: "node:22" }, PROJECT, {
    CI: "1",
    DATABASE_URL: "postgres://localhost:5432/app",
    PATH: "/usr/local/bin",
    HOME: "/root",
  });
  const args = result.args.join(" ");
  assert.match(args, /-e CI=1/);
  assert.match(args, /-e DATABASE_URL=postgres:\/\/localhost:5432\/app/);
  assert.ok(!args.includes("-e PATH="), "the host PATH would break the image");
  assert.ok(!args.includes("-e HOME="));
});

test("workdir, volumes, pull, network, options and env are honored", () => {
  const result = plan({
    image: "node:22",
    workdir: "/src",
    volumes: ["cache:/root/.npm"],
    pull: "never",
    network: "testnet",
    options: ["--user 1000:1000"],
    env: { EXTRA: "yes" },
  });
  const args = result.args.join(" ");
  assert.equal(result.workdir, "/src");
  assert.match(args, /--pull=never/);
  assert.match(args, /--network testnet/);
  assert.ok(args.includes(`-v ${PROJECT}:/src`));
  assert.match(args, /-v cache:\/root\/\.npm/);
  assert.match(args, /--user 1000:1000/, "extra options are split into separate arguments");
  assert.match(args, /-e EXTRA=yes/);
});

test("templates are resolved and kubernetes is rejected", () => {
  const result = plan({ image: "app:${{ ports.web }}", engine: "podman" });
  assert.ok(result.args.includes("app:5001"));
  assert.throws(
    () => plan({ image: "x", engine: "kubernetes" }),
    /test body needs the project mounted/,
  );
});
