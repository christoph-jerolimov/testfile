import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { stringify } from "yaml";
import { formatRepro, reproCommand, reproEnv, reproOf, shellArg, tailOf } from "./repro.js";
import { RunHistory, type RunRecord } from "./runrecord.js";

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "testfile-repro-"));
  process.on("exit", () => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// Writes a run folder from a full record, so a test can pin fields the
// generic fixture writer does not model (suite trees, env, per-leg results).
function writeRecord(base: string, record: RunRecord, logs: Record<string, string> = {}): void {
  const dir = join(base, ".testfile", "runs", record.id);
  mkdirSync(dir, { recursive: true });
  for (const [path, text] of Object.entries(logs)) {
    mkdirSync(join(dir, path, ".."), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  writeFileSync(join(dir, "run.yaml"), stringify(record));
}

const record: RunRecord = {
  id: "20260810-120000-aaaa",
  startedAt: "2026-08-10T12:00:00.000Z",
  durationMs: 4200,
  status: "failed",
  exitCode: 1,
  cancelled: false,
  machine: "ci-linux",
  labels: { branch: "main", pr: "42" },
  env: { CI: "1", DATABASE_URL: "postgres://localhost:5432/test", NOTE: "a b" },
  ports: {},
  selected: ["ci"],
  suite: {
    name: "ci",
    path: "ci",
    kind: "sequence",
    tags: ["ci"],
    children: [
      { name: "build", path: "ci/build", kind: "command" },
      {
        name: "e2e",
        path: "ci/e2e",
        kind: "command",
        tags: ["slow"],
        services: ["db"],
        matrix: { browser: "firefox" },
      },
    ],
  },
  tests: [
    { path: "ci", status: "failed" },
    { path: "ci/build", status: "passed", durationMs: 1200 },
    {
      path: "ci/e2e",
      status: "failed",
      durationMs: 2600,
      log: "tests/ci-e2e.log",
      artifacts: ["artifacts/ci-e2e/trace.zip"],
      reason: "cache miss: src/**: 1 changed file",
    },
  ],
  services: [
    { name: "db", status: "stopped", log: "services/db.log" },
    { name: "proxy", status: "stopped" },
  ],
};

function historyWith(run: RunRecord, logs: Record<string, string> = {}): RunHistory {
  const dir = tempDir();
  writeRecord(dir, run, logs);
  return new RunHistory(dir);
}

test("a repro bundle carries the run, the test and the command to rerun it", () => {
  const history = historyWith(record, {
    "tests/ci-e2e.log": ["one", "two", "three", "boom: expected 4 to equal 5"].join("\n"),
  });
  const repro = reproOf(history, history.find(record.id)!, "ci/e2e");

  assert.equal(repro.run.id, record.id);
  assert.equal(repro.run.machine, "ci-linux");
  assert.deepEqual(repro.run.labels, { branch: "main", pr: "42" });
  assert.equal(repro.test.status, "failed");
  assert.equal(repro.test.durationMs, 2600);
  assert.match(repro.test.reason!, /cache miss/);
  // tags are inherited from the group, the matrix comes from the node
  assert.deepEqual(repro.test.tags, ["ci", "slow"]);
  assert.deepEqual(repro.test.matrix, { browser: "firefox" });
  // the command narrows to this one test and pins its matrix instance
  assert.equal(repro.command, "testfile start -n ci/e2e -m browser:firefox");
  // only the services the test declares, not every service of the run
  assert.deepEqual(
    repro.services.map((service) => service.name),
    ["db"],
  );
  assert.deepEqual(repro.artifacts, ["artifacts/ci-e2e/trace.zip"]);
  assert.match(repro.logTail!, /boom: expected 4 to equal 5/);
});

test("the recorded env is offered, minus what every run sets anyway", () => {
  assert.deepEqual(reproEnv(record), {
    DATABASE_URL: "postgres://localhost:5432/test",
    NOTE: "a b",
  });
  const history = historyWith(record);
  const text = formatRepro(reproOf(history, history.find(record.id)!, "ci/e2e"));
  // exports come before the command, and a value with a space is quoted
  assert.match(text, /export DATABASE_URL=postgres:\/\/localhost:5432\/test/);
  assert.match(text, /export NOTE='a b'/);
  assert.ok(
    text.indexOf("export DATABASE_URL") < text.indexOf("testfile start"),
    "the environment is set before the command that needs it",
  );
  assert.doesNotMatch(text, /export CI=/, "CI is set by any run, so it explains nothing");
});

test("a run's variants are passed on, so the rerun records the same leg", () => {
  const run: RunRecord = { ...record, variants: { platform: "linux" } };
  assert.equal(
    reproCommand(run, "ci/build"),
    "testfile start -n ci/build --variant platform=linux",
  );
});

test("a merged run reproduces one leg, and says so when asked for an unknown one", () => {
  const merged: RunRecord = {
    ...record,
    id: "20260810-130000-bbbb",
    tests: [
      {
        path: "ci/e2e",
        status: "passed",
        variants: { platform: "linux" },
        origin: "20260810-125000-lnx1",
        log: "tests/linux.log",
      },
      {
        path: "ci/e2e",
        status: "failed",
        variants: { platform: "windows" },
        origin: "20260810-125500-win2",
        log: "tests/windows.log",
      },
    ],
  };
  const history = historyWith(merged, {
    "tests/linux.log": "all good",
    "tests/windows.log": "path separator mismatch",
  });
  const run = history.find(merged.id)!;

  // without a variant the failing leg is the one worth reproducing
  const failing = reproOf(history, run, "ci/e2e");
  assert.equal(failing.run.origin, "20260810-125500-win2");
  assert.match(failing.logTail!, /path separator mismatch/);

  // ... and a named leg wins over that
  const linux = reproOf(history, run, "ci/e2e", { variants: { platform: "linux" } });
  assert.equal(linux.run.origin, "20260810-125000-lnx1");
  assert.match(linux.logTail!, /all good/);

  assert.throws(
    () => reproOf(history, run, "ci/e2e", { variants: { platform: "sunos" } }),
    /no result of "ci\/e2e".*matches those variants.*platform=linux/s,
  );
});

test("a test the run never executed cannot be reproduced", () => {
  const history = historyWith(record);
  assert.throws(
    () => reproOf(history, history.find(record.id)!, "ci/nope"),
    /was not executed in run/,
  );
});

test("a run without a suite tree offers every service rather than none", () => {
  const flat: RunRecord = { ...record, suite: undefined };
  const history = historyWith(flat);
  const repro = reproOf(history, history.find(flat.id)!, "ci/e2e");
  assert.deepEqual(
    repro.services.map((service) => service.name),
    ["db", "proxy"],
  );
  // no tree means no tags and no matrix to pin either
  assert.equal(repro.test.tags, undefined);
  assert.equal(repro.command, "testfile start -n ci/e2e");
});

test("the log tail is the end of the log, and absent when there is no log", () => {
  const lines = Array.from({ length: 100 }, (_, i) => `line ${i}`).join("\n");
  assert.equal(tailOf(lines, 3), "line 97\nline 98\nline 99");
  assert.equal(tailOf("only\n", 5), "only", "a trailing newline is not a line");
  assert.equal(tailOf("", 5), undefined);
  assert.equal(tailOf(undefined, 5), undefined);

  const history = historyWith(record);
  const repro = reproOf(history, history.find(record.id)!, "ci/build");
  assert.equal(repro.logTail, undefined, "this test recorded no log");
});

test("a long artifact list is previewed, not dumped", () => {
  const many: RunRecord = {
    ...record,
    id: "20260810-140000-cccc",
    tests: [
      {
        path: "ci/e2e",
        status: "failed",
        artifacts: Array.from({ length: 23 }, (_, i) => `artifacts/case-${i}.md`),
      },
    ],
  };
  const history = historyWith(many);
  const repro = reproOf(history, history.find(many.id)!, "ci/e2e");
  assert.equal(repro.artifacts.length, 23, "the bundle itself keeps them all");

  const text = formatRepro(repro);
  assert.match(text, /artifacts\/case-9\.md/);
  assert.doesNotMatch(text, /artifacts\/case-10\.md/);
  assert.match(text, /\.\.\. and 13 more \(--json lists them all\)/);
});

test("shellArg quotes only what a shell would misread", () => {
  assert.equal(shellArg("ci/unit"), "ci/unit");
  assert.equal(shellArg("browser:firefox"), "browser:firefox");
  assert.equal(shellArg("a b"), "'a b'");
  assert.equal(shellArg("it's"), `'it'\\''s'`);
  assert.equal(shellArg("$(rm -rf /)"), `'$(rm -rf /)'`);
});
