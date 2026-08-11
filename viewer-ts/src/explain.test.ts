import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { stringify } from "yaml";
import { explainOf, formatExplain } from "./explain.js";
import { RunHistory, type RunRecord, type RunRecordTest } from "./runrecord.js";

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "testfile-explain-"));
  process.on("exit", () => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function run(
  id: string,
  startedAt: string,
  tests: RunRecordTest[],
  extra: Partial<RunRecord> = {},
): RunRecord {
  return {
    id,
    startedAt,
    durationMs: 4200,
    status: tests.some((t) => t.status === "failed") ? "failed" : "passed",
    exitCode: 0,
    cancelled: false,
    env: {},
    ports: {},
    selected: ["ci"],
    tests,
    ...extra,
  };
}

// A history on disk, so the digest reads the logs the way it will in use.
function historyWith(runs: RunRecord[], logs: Record<string, Record<string, string>> = {}) {
  const dir = tempDir();
  for (const record of runs) {
    const runDir = join(dir, ".testfile", "runs", record.id);
    mkdirSync(runDir, { recursive: true });
    for (const [path, text] of Object.entries(logs[record.id] ?? {})) {
      mkdirSync(join(runDir, path, ".."), { recursive: true });
      writeFileSync(join(runDir, path), text);
    }
    writeFileSync(join(runDir, "run.yaml"), stringify(record));
  }
  return new RunHistory(dir);
}

test("a digest names what failed, with the end of its log and its history", () => {
  const history = historyWith(
    [
      run(
        "20260802-120000-bbbb",
        "2026-08-02T12:00:00.000Z",
        [
          { path: "ci/build", status: "passed", durationMs: 1200 },
          {
            path: "ci/unit",
            status: "failed",
            durationMs: 2600,
            log: "tests/unit.log",
            reason: "cache miss: src/**: 1 changed file",
          },
        ],
        { machine: "ci-linux", labels: { branch: "main" } },
      ),
      run("20260801-120000-aaaa", "2026-08-01T12:00:00.000Z", [
        { path: "ci/build", status: "passed" },
        { path: "ci/unit", status: "passed" },
      ]),
    ],
    {
      "20260802-120000-bbbb": {
        "tests/unit.log": Array.from({ length: 50 }, (_, i) => `line ${i}`)
          .concat("boom: expected 4 to equal 5")
          .join("\n"),
      },
    },
  );
  const explain = explainOf(history, history.find("20260802")!);

  assert.equal(explain.run.machine, "ci-linux");
  assert.deepEqual(explain.counts, { passed: 1, failed: 1 });
  assert.equal(explain.failures.length, 1);
  const [failure] = explain.failures;
  assert.equal(failure.path, "ci/unit");
  assert.match(failure.reason!, /cache miss/);
  assert.match(failure.logTail!, /boom: expected 4 to equal 5/);
  assert.doesNotMatch(failure.logTail!, /line 30\b/, "only the tail is kept");
  // two results is not enough evidence to judge the test
  assert.equal(failure.verdict, "unknown");
  assert.equal(failure.recentResults, 2);
  assert.equal(failure.recentFailures, 1);

  // and what changed since the run before
  assert.equal(explain.previous!.id, "20260801-120000-aaaa");
  assert.deepEqual(explain.previous!.newlyFailed, ["ci/unit"]);
  assert.deepEqual(explain.previous!.fixed, []);
});

test("a test that fails half the time is called flaky, not simply failed", () => {
  const runs = Array.from({ length: 12 }, (_, i) =>
    run(
      `202608${String(12 - i).padStart(2, "0")}-120000-r${i}`,
      `2026-08-${String(12 - i).padStart(2, "0")}T12:00:00.000Z`,
      [{ path: "ci/e2e", status: i % 2 === 0 ? "failed" : "passed" }],
    ),
  );
  const history = historyWith(runs);
  const explain = explainOf(history, history.runs[0]!);
  const [failure] = explain.failures;
  assert.equal(failure.verdict, "flaky");
  assert.equal(failure.recentResults, 12);
  assert.equal(failure.recentFailures, 6);

  const text = formatExplain(explain);
  assert.match(text, /known flaky — 6\/12 of its recent results failed/);
});

test("the log excerpt is plain text: colour a terminal would render is dropped", () => {
  const history = historyWith(
    [
      run("20260802-120000-bbbb", "2026-08-02T12:00:00.000Z", [
        { path: "ci/unit", status: "failed", log: "tests/unit.log" },
      ]),
    ],
    {
      "20260802-120000-bbbb": {
        "tests/unit.log": "[31mboom[0m: expected [1m4[0m",
      },
    },
  );
  const explain = explainOf(history, history.runs[0]!);
  assert.equal(explain.failures[0].logTail, "boom: expected 4");
});

test("a green run says so instead of printing an empty failure section", () => {
  const history = historyWith([
    run("20260802-120000-bbbb", "2026-08-02T12:00:00.000Z", [
      { path: "ci/build", status: "passed" },
    ]),
  ]);
  const text = formatExplain(explainOf(history, history.runs[0]!));
  assert.match(text, /# run 20260802-120000-bbbb: passed/);
  assert.match(text, /none — nothing in this run failed/);
});

test("the digest is bounded: fewer failures detailed, shorter logs", () => {
  const tests: RunRecordTest[] = Array.from({ length: 7 }, (_, i) => ({
    path: `ci/case-${i}`,
    status: "failed" as const,
    log: `tests/case-${i}.log`,
  }));
  const logs = Object.fromEntries(
    tests.map((test, i) => [
      test.log!,
      Array.from({ length: 30 }, (_, line) => `case ${i} line ${line}`).join("\n"),
    ]),
  );
  const history = historyWith([run("20260802-120000-bbbb", "2026-08-02T12:00:00.000Z", tests)], {
    "20260802-120000-bbbb": logs,
  });
  const explain = explainOf(history, history.runs[0]!, { maxFailures: 3, logLines: 2 });

  assert.equal(explain.failures.length, 3);
  assert.equal(explain.omittedFailures, 4);
  assert.equal(explain.failures[0].logTail, "case 0 line 28\ncase 0 line 29");

  const text = formatExplain(explain);
  assert.match(text, /## failures \(7\)/, "the count is of all of them, not of the detailed ones");
  assert.match(text, /\.\.\. and 4 more failing tests, not detailed here/);
});

test("a merged run's failure says which leg it came from", () => {
  const history = historyWith([
    run("20260802-120000-bbbb", "2026-08-02T12:00:00.000Z", [
      { path: "ci/unit", status: "passed", variants: { platform: "linux" } },
      { path: "ci/unit", status: "failed", variants: { platform: "windows" } },
    ]),
  ]);
  const explain = explainOf(history, history.runs[0]!);
  assert.equal(explain.failures.length, 1);
  assert.deepEqual(explain.failures[0].variants, { platform: "windows" });
  assert.match(formatExplain(explain), /### ci\/unit \(platform=windows\)/);
});

test("the leaf that broke comes before the groups it broke", () => {
  const history = historyWith(
    [
      run("20260802-120000-bbbb", "2026-08-02T12:00:00.000Z", [
        { path: "ci", status: "failed" },
        { path: "ci/checks", status: "failed" },
        { path: "ci/checks/unit", status: "failed", log: "tests/unit.log" },
      ]),
    ],
    { "20260802-120000-bbbb": { "tests/unit.log": "boom" } },
  );
  const explain = explainOf(history, history.runs[0]!);
  assert.deepEqual(
    explain.failures.map((failure) => failure.path),
    ["ci/checks/unit", "ci", "ci/checks"],
  );
  assert.equal(explain.failures[0].group, undefined, "the leaf is not a group");
  assert.equal(explain.failures[1].group, true);

  // ... so a tight budget keeps the leaf and drops the groups
  const tight = explainOf(history, history.runs[0]!, { maxFailures: 1 });
  assert.deepEqual(
    tight.failures.map((failure) => failure.path),
    ["ci/checks/unit"],
  );
  assert.equal(tight.omittedFailures, 2);

  const text = formatExplain(explain);
  assert.match(text, /### ci — group/);
  assert.match(text, /a group: it failed because something under it did/);
});

test("an analysis someone added is carried and shown as an opinion", () => {
  const history = historyWith([
    run(
      "20260802-120000-bbbb",
      "2026-08-02T12:00:00.000Z",
      [{ path: "ci/unit", status: "failed" }],
      {
        analysis: {
          text: "Port 5432 collides between ci/migrations and ci/e2e.\nNot this change.",
          author: "claude-code",
          at: "2026-08-02T12:10:00.000Z",
        },
      },
    ),
  ]);
  const explain = explainOf(history, history.runs[0]!);
  assert.equal(explain.analysis?.author, "claude-code");

  const text = formatExplain(explain);
  assert.match(text, /## analysis \(added after the run by claude-code\)/);
  assert.match(text, /Port 5432 collides/);
  // it never becomes a result: the run is still failed, the counts stand
  assert.match(text, /# run 20260802-120000-bbbb: failed/);
  assert.match(text, /tests: 1 failed/);
});

test("the first recorded run has nothing to compare against", () => {
  const history = historyWith([
    run("20260802-120000-bbbb", "2026-08-02T12:00:00.000Z", [
      { path: "ci/unit", status: "failed" },
    ]),
  ]);
  const explain = explainOf(history, history.runs[0]!);
  assert.equal(explain.previous, undefined);
  assert.doesNotMatch(formatExplain(explain), /the run before/);
});
