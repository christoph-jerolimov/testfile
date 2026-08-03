import assert from "node:assert/strict";
import { test } from "node:test";
import { buildTestContainerArgs, DEFAULT_WORKDIR } from "./testcontainer.js";
import type { Scopes } from "./template.js";

const scopes: Scopes = { env: {}, ports: { web: 5001 }, matrix: {} };

function plan(def: Parameters<typeof buildTestContainerArgs>[0], hostCwd = "/proj", env = {}) {
  return buildTestContainerArgs(
    def,
    hostCwd,
    "/proj",
    env,
    scopes,
    'test "x"',
    ["sh", "-c", "npm test"]
  );
}

test("the project is mounted and the shell runs inside the image", () => {
  const result = plan({ image: "golang:1.23", engine: "docker" });
  assert.equal(result.engine, "docker");
  assert.equal(result.workdir, DEFAULT_WORKDIR);
  const args = result.args.join(" ");
  assert.match(args, /^run --rm -i /);
  assert.match(args, /--network host/, "host networking keeps services reachable");
  assert.match(args, new RegExp(`-v /proj:${DEFAULT_WORKDIR}`));
  assert.match(args, new RegExp(`-w ${DEFAULT_WORKDIR}`));
  assert.match(args, /--entrypoint sh golang:1\.23 -c npm test$/);
});

test("a nested working directory maps into the mount", () => {
  const result = plan({ image: "node:22" }, "/proj/packages/api");
  assert.equal(result.workdir, `${DEFAULT_WORKDIR}/packages/api`);
  assert.ok(result.args.includes(`${DEFAULT_WORKDIR}/packages/api`));
});

test("the test environment is passed through, host-specific variables are not", () => {
  const result = plan({ image: "node:22" }, "/proj", {
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
  assert.match(args, /-v \/proj:\/src/);
  assert.match(args, /-v cache:\/root\/\.npm/);
  assert.match(args, /--user 1000:1000/, "extra options are split into separate arguments");
  assert.match(args, /-e EXTRA=yes/);
});

test("templates are resolved and kubernetes is rejected", () => {
  const result = plan({ image: "app:${{ ports.web }}", engine: "podman" });
  assert.ok(result.args.includes("app:5001"));
  assert.throws(
    () => plan({ image: "x", engine: "kubernetes" }),
    /reserved for a future version/
  );
});
