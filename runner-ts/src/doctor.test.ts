import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import {
  commandsUsed,
  commandTokens,
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
  // executables on this machine's PATH, and executable files by absolute path
  onPath?: Record<string, string>;
  executables?: string[];
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
    onPath: (command) => options.onPath?.[command],
    executableAt: (path) => (options.executables ?? []).includes(path),
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

// an absolute path on every platform ("/repo" is drive-relative on Windows)
const REPO = resolve("/repo");

const doc = (test: TestfileDoc["test"], rest: Partial<TestfileDoc> = {}): TestfileDoc => ({
  version: 0,
  test,
  ...rest,
});

test("a healthy machine passes every check", async () => {
  const checks = await runChecks(
    doc({ name: "unit", command: "npm test" }),
    "/repo",
    machine({ commands: HEALTHY, onPath: { npm: "/usr/bin/npm" } }),
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
    machine({ commands: HEALTHY, nodeVersion: "v18.20.0", onPath: { npm: "/usr/bin/npm" } }),
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
    machine({ commands: withoutGit, onPath: { npm: "/usr/bin/npm" } }),
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
      onPath: { npm: "/usr/bin/npm" },
    }),
  );
  assert.equal(find(checks, "git").status, "ok");
  assert.equal(find(checks, "git repository").status, "warn");
});

test("a Testfile that runs containers checks all three engines", async () => {
  delete process.env.TESTFILE_ENGINE;
  const withContainer = doc({
    name: "e2e",
    command: "pytest",
    container: { image: "python:3.12" },
  });
  // no engine anywhere: every engine gets a row, and the selection fails
  const checks = await runChecks(
    withContainer,
    "/repo",
    machine({ commands: { git: HEALTHY.git, "sh -c exit 0": { ok: true } } }),
  );
  assert.equal(find(checks, "container engine (podman)").status, "fail");
  assert.equal(find(checks, "container engine (docker)").status, "fail");
  assert.equal(find(checks, "container engine (kubernetes)").status, "fail");
  assert.equal(find(checks, "engine selection").status, "fail");
  assert.match(find(checks, "engine selection").hint ?? "", /podman or docker.*kubectl/);

  // podman installed but dead, nothing else: still a failure, with the reason
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

test("the first responding engine is the one a run would use", async () => {
  delete process.env.TESTFILE_ENGINE;
  const withContainer = doc({ name: "e2e", command: "x", container: { image: "node:22" } });
  // docker responds, podman is absent, kubernetes unreachable
  const checks = await runChecks(
    withContainer,
    "/repo",
    machine({
      commands: {
        ...HEALTHY,
        "podman --version": { ok: false },
        "podman info": { ok: false },
        "docker --version": { ok: true },
        "docker info": { ok: true },
        "kubectl version --client": { ok: true },
        "kubectl cluster-info": { ok: false },
      },
    }),
  );
  assert.match(find(checks, "container engine (docker)").detail, /this run would use it/);
  // an unreachable cluster is a warning, not a failure - docker covers the run
  assert.equal(find(checks, "container engine (kubernetes)").status, "warn");
  assert.equal(
    checks.some((c) => c.name === "engine selection"),
    false,
  );
});

test("a pinned engine that does not respond fails the selection", async () => {
  process.env.TESTFILE_ENGINE = "kubernetes";
  try {
    const checks = await runChecks(
      doc({ name: "e2e", command: "x", container: { image: "node:22" } }),
      "/repo",
      machine({ commands: HEALTHY }),
    );
    const selection = find(checks, "engine selection");
    assert.equal(selection.status, "fail");
    assert.match(selection.detail, /pins "kubernetes"/);
  } finally {
    delete process.env.TESTFILE_ENGINE;
  }
});

test("any container makes the run need an engine, none names one", () => {
  const needs = containerNeeds(
    doc({
      parallel: [
        { name: "a", command: "x", container: { image: "node:22" } },
        { name: "b", command: "y" },
      ],
    }),
  );
  assert.deepEqual(needs, { needed: true });
  assert.deepEqual(containerNeeds(doc({ command: "x" })), { needed: false });
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
    machine({ commands: HEALTHY, busyPorts: [8080], onPath: { npm: "/usr/bin/npm" } }),
  );
  assert.equal(find(checks, "port web").status, "fail");
  assert.match(find(checks, "port web").hint ?? "", /random/);
  assert.equal(checks.filter((check) => check.name.startsWith("port ")).length, 1);
});

test("an unwritable .testfile/ fails", async () => {
  const checks = await runChecks(
    doc({ command: "npm test" }),
    "/repo",
    machine({
      commands: HEALTHY,
      writeProblem: "EACCES: permission denied",
      onPath: { npm: "/usr/bin/npm" },
    }),
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

test("commandTokens reads the executables a shell line starts with", () => {
  assert.deepEqual(commandTokens("npm test"), ["npm"]);
  assert.deepEqual(commandTokens("cd packages/app && pytest -q"), ["pytest"]);
  assert.deepEqual(commandTokens("go build ./... | tee build.log"), ["go", "tee"]);
  assert.deepEqual(commandTokens("CI=1 FORCE_COLOR=1 vitest run"), ["vitest"]);
  assert.deepEqual(commandTokens("./scripts/build.sh"), ["./scripts/build.sh"]);
  // builtins are the shell's own, and templates are only known at run time
  assert.deepEqual(commandTokens("echo hi; test -f x; true"), []);
  assert.deepEqual(commandTokens("${{ env.TOOL }} --version"), []);
  assert.deepEqual(commandTokens('"my tool" run'), []);
});

test("commandsUsed collects tests, hooks and services with their directory", () => {
  const uses = commandsUsed(
    doc(
      {
        name: "ci",
        workdir: "app",
        sequence: [
          { name: "unit", command: "vitest run", setup: { command: "prisma migrate" } },
          { name: "e2e", workdir: "e2e", command: "./run.sh --headed" },
          {
            name: "boxed",
            container: { image: "node:22" },
            command: "only-inside-the-image",
            sequence: [{ name: "nested", command: "also-inside" }],
          },
          { name: "ps", shell: "pwsh", command: "Get-Date" },
        ],
      },
      {
        services: {
          db: { command: "postgres -D data", ready: { exec: "pg_isready" } },
          // probed from inside its own image, so nothing is expected here
          cache: { container: { image: "redis" }, ready: { exec: "redis-cli ping" } },
          // ... unless the probe explicitly belongs on this machine
          minio: {
            container: { image: "minio" },
            ready: { exec: { command: "mc ready local", host: true } },
          },
        },
      },
    ),
    REPO,
  );
  assert.deepEqual(
    uses.map((use) => `${use.token} @ ${use.dir}`),
    [
      `./run.sh @ ${resolve(REPO, "app/e2e")}`,
      `mc @ ${REPO}`,
      `pg_isready @ ${REPO}`,
      `postgres @ ${REPO}`,
      `prisma @ ${resolve(REPO, "app")}`,
      `vitest @ ${resolve(REPO, "app")}`,
    ],
    "workdir decides where a relative command resolves; containers and custom shells are left out",
  );
  assert.equal(uses.find((use) => use.token === "vitest")?.where, "ci/unit");
});

test("a command that is not on PATH fails, one that is passes", async () => {
  const checks = await runChecks(
    doc({
      name: "unit",
      sequence: [
        { name: "a", command: "npm test" },
        { name: "b", command: "pytest" },
      ],
    }),
    "/repo",
    machine({ commands: HEALTHY, onPath: { npm: "/usr/bin/npm" } }),
  );
  assert.equal(find(checks, "command (npm)").detail, "/usr/bin/npm");
  const missing = find(checks, "command (pytest)");
  assert.equal(missing.status, "fail");
  assert.equal(missing.detail, "not found on PATH");
  assert.match(missing.hint ?? "", /used by unit\/b/);
});

test("a relative command is resolved against the test's directory", async () => {
  const withScripts = doc({
    name: "ci",
    workdir: "app",
    parallel: [
      { name: "build", command: "./scripts/build.sh" },
      { name: "gone", command: "./scripts/gone.sh --fast" },
      { name: "absolute", command: resolve(REPO, "opt/tool") },
    ],
  });
  const build = resolve(REPO, "app/scripts/build.sh");
  const checks = await runChecks(
    withScripts,
    REPO,
    machine({ commands: HEALTHY, executables: [build, resolve(REPO, "opt/tool")] }),
  );
  assert.equal(find(checks, "command (./scripts/build.sh)").detail, build);
  assert.equal(find(checks, `command (${resolve(REPO, "opt/tool")})`).status, "ok");
  const gone = find(checks, "command (./scripts/gone.sh)");
  assert.equal(gone.status, "fail");
  assert.equal(gone.detail, `${resolve(REPO, "app/scripts/gone.sh")} is missing or not executable`);
  assert.match(gone.hint ?? "", /chmod \+x/);
});

test("the same command used twice is one check that names both places", async () => {
  const checks = await runChecks(
    doc({
      name: "ci",
      parallel: [
        { name: "one", command: "npm run a" },
        { name: "two", command: "npm run b" },
      ],
    }),
    "/repo",
    machine({ commands: HEALTHY, onPath: { npm: "/usr/bin/npm" } }),
  );
  assert.equal(checks.filter((check) => check.name === "command (npm)").length, 1);
});

test("a Testfile with only scripts and builtins has nothing to look up", async () => {
  const checks = await runChecks(
    doc({ name: "root", script: "for f in *; do echo $f; done" }),
    "/repo",
    machine({ commands: HEALTHY }),
  );
  assert.equal(find(checks, "commands").detail, "no plain commands to look up");
  assert.equal(worstOf(checks), "ok");
});

test("without a Testfile only the machine is checked", async () => {
  const checks = await runChecks(undefined, "/repo", machine({ commands: HEALTHY }));
  assert.deepEqual(
    checks.map((check) => check.name),
    ["node", "git", "container engine", "ports", ".testfile/"],
  );
  assert.equal(worstOf(checks), "ok");
  assert.equal(find(checks, "container engine").detail, "podman available (no Testfile to read)");
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
