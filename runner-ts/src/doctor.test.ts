import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  containerNeeds,
  fixedPorts,
  realEnv,
  runChecks,
  shellsUsed,
  worstOf,
  type Check,
  type DoctorEnv,
} from "./doctor.js";
import type { TestfileDoc } from "./model.js";

// A machine, described: which commands work, which ports are taken and
// whether .testfile/ can be written.
function machine(options: {
  commands?: Record<string, { ok: boolean; output?: string }>;
  busyPorts?: number[];
  writeProblem?: string;
  nodeVersion?: string;
  platform?: string;
}): DoctorEnv {
  return {
    probe(command, args) {
      const key = `${command} ${args.join(" ")}`;
      const entry = options.commands?.[key] ?? options.commands?.[command];
      if (!entry) return { ok: false, output: `spawn ${command} ENOENT` };
      return { ok: entry.ok, output: entry.output ?? "" };
    },
    canBind: (port) => Promise.resolve(!(options.busyPorts ?? []).includes(port)),
    writeTest: () => options.writeProblem,
    nodeVersion: options.nodeVersion ?? "v22.0.0",
    platform: options.platform ?? "linux",
  };
}

const HEALTHY = {
  git: { ok: true, output: "git version 2.43.0" },
  "git -C /repo rev-parse --is-inside-work-tree": { ok: true, output: "true" },
  "sh -c exit 0": { ok: true },
  "podman --version": { ok: true, output: "podman version 5" },
  "podman info": { ok: true },
};

function find(checks: Check[], name: string): Check {
  const check = checks.find((c) => c.name === name);
  assert.ok(check, `no "${name}" check in ${checks.map((c) => c.name).join(", ")}`);
  return check;
}

const doc = (test: TestfileDoc["test"], rest: Partial<TestfileDoc> = {}): TestfileDoc => ({
  version: 0,
  test,
  ...rest,
});

test("a healthy machine passes every check", async () => {
  const checks = await runChecks(
    doc({ name: "unit", command: "npm test" }),
    "/repo",
    machine({ commands: HEALTHY }),
  );
  assert.equal(worstOf(checks), "ok");
  assert.equal(find(checks, "node").status, "ok");
  assert.equal(find(checks, "shell (sh)").status, "ok");
  assert.match(find(checks, "container engine").detail, /not needed/);
});

test("an old node fails the run before it starts", async () => {
  const checks = await runChecks(
    doc({ name: "unit", command: "npm test" }),
    "/repo",
    machine({ commands: HEALTHY, nodeVersion: "v18.20.0" }),
  );
  assert.equal(find(checks, "node").status, "fail");
  assert.match(find(checks, "node").detail, /needs 20 or newer/);
  assert.equal(worstOf(checks), "fail");
});

test("a missing git is a warning - only --changed needs it", async () => {
  const { git: _git, ...withoutGit } = HEALTHY;
  const checks = await runChecks(
    doc({ command: "npm test" }),
    "/repo",
    machine({ commands: withoutGit }),
  );
  assert.equal(find(checks, "git").status, "warn");
  assert.match(find(checks, "git").hint ?? "", /--changed/);
  assert.equal(worstOf(checks), "warn");
});

test("a folder outside a work tree is reported separately", async () => {
  const checks = await runChecks(
    doc({ command: "npm test" }),
    "/repo",
    machine({
      commands: { ...HEALTHY, "git -C /repo rev-parse --is-inside-work-tree": { ok: false } },
    }),
  );
  assert.equal(find(checks, "git").status, "ok");
  assert.equal(find(checks, "git repository").status, "warn");
});

test("a Testfile that runs containers needs an engine", async () => {
  const withContainer = doc({
    name: "e2e",
    command: "pytest",
    container: { image: "python:3.12" },
  });
  const checks = await runChecks(
    withContainer,
    "/repo",
    machine({ commands: { git: HEALTHY.git, "sh -c exit 0": { ok: true } } }),
  );
  assert.equal(find(checks, "container engine").status, "fail");
  assert.match(find(checks, "container engine").hint ?? "", /install podman or docker/);

  // ... and reports the one that is installed but not running
  const stopped = await runChecks(
    withContainer,
    "/repo",
    machine({
      commands: {
        ...HEALTHY,
        "podman info": { ok: false, output: "Cannot connect to Podman" },
      },
    }),
  );
  const engine = find(stopped, "container engine (podman)");
  assert.equal(engine.status, "fail", "the Testfile needs it, so a dead engine fails");
  assert.match(engine.detail, /Cannot connect to Podman/);
});

test("an explicit engine is the only one looked for", () => {
  const needs = containerNeeds(
    doc({
      parallel: [
        { name: "a", command: "x", container: { image: "node:22", engine: "docker" } },
        { name: "b", command: "y" },
      ],
    }),
  );
  assert.deepEqual(needs, { needed: true, engines: ["docker"] });
  assert.deepEqual(containerNeeds(doc({ command: "x" })), { needed: false, engines: [] });
});

test("services in a nested test count as containers too", () => {
  const needs = containerNeeds(
    doc({
      sequence: [
        {
          name: "e2e",
          command: "npm run e2e",
          services: { db: { container: { image: "postgres:16" } } },
        },
      ],
    }),
  );
  assert.equal(needs.needed, true);
});

test("fixed ports are probed, random ones are not", async () => {
  const withPorts = doc({ command: "npm test" }, { ports: { web: 8080, api: "random" } });
  assert.deepEqual(fixedPorts(withPorts), [{ name: "web", port: 8080 }]);

  const checks = await runChecks(
    withPorts,
    "/repo",
    machine({ commands: HEALTHY, busyPorts: [8080] }),
  );
  assert.equal(find(checks, "port web").status, "fail");
  assert.match(find(checks, "port web").hint ?? "", /random/);
  assert.equal(checks.filter((check) => check.name.startsWith("port ")).length, 1);
});

test("an unwritable .testfile/ fails", async () => {
  const checks = await runChecks(
    doc({ command: "npm test" }),
    "/repo",
    machine({ commands: HEALTHY, writeProblem: "EACCES: permission denied" }),
  );
  assert.equal(find(checks, ".testfile/").status, "fail");
  assert.match(find(checks, ".testfile/").detail, /EACCES/);
});

test("every shell a test names is checked, on Windows with a hint", async () => {
  const withShells = doc({
    parallel: [
      { name: "posix", script: "echo hi" },
      { name: "pwsh", command: "Get-Date", shell: "pwsh -NoProfile" },
      { name: "templated", command: "x", shell: "${{ env.SHELL }}" },
      { name: "group", sequence: [{ name: "nested", command: "y" }] },
    ],
  });
  assert.deepEqual(shellsUsed(withShells), ["pwsh", "sh"]);

  const checks = await runChecks(
    withShells,
    "/repo",
    machine({ commands: HEALTHY, platform: "win32" }),
  );
  assert.equal(find(checks, "shell (sh)").status, "ok");
  const pwsh = find(checks, "shell (pwsh)");
  assert.equal(pwsh.status, "fail");
  assert.match(pwsh.hint ?? "", /install pwsh/);

  const noSh = await runChecks(
    doc({ command: "npm test" }),
    "/repo",
    machine({ commands: { git: HEALTHY.git }, platform: "win32" }),
  );
  assert.match(find(noSh, "shell (sh)").hint ?? "", /Git for Windows/);
});

test("without a Testfile only the machine is checked", async () => {
  const checks = await runChecks(undefined, "/repo", machine({ commands: HEALTHY }));
  assert.deepEqual(
    checks.map((check) => check.name),
    ["node", "git", "container engine", "ports", ".testfile/"],
  );
  assert.equal(worstOf(checks), "ok");
  assert.equal(find(checks, "container engine").detail, "podman installed (no Testfile to read)");
  assert.equal(find(checks, "ports").detail, "no Testfile to read");
});

test("the real environment probes the machine it runs on", async () => {
  const dir = mkdtempSync(join(tmpdir(), "testfile-doctor-"));
  try {
    assert.equal(realEnv.probe("node", ["--version"]).ok, true);
    assert.equal(realEnv.probe("definitely-not-a-command", []).ok, false);
    assert.equal(realEnv.writeTest(join(dir, ".testfile")), undefined);
    assert.equal(await realEnv.canBind(0), true, "port 0 is always assignable");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
