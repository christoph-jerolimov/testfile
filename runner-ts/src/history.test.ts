import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { parse, stringify } from "yaml";
import { RunHistory, type RunMeta, type RunRecord } from "./history.js";

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "testfile-history-"));
  process.on("exit", () => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function meta(startedAtMs: number, status: "passed" | "failed" = "passed"): RunMeta {
  return {
    startedAtMs,
    durationMs: 5,
    status,
    exitCode: status === "passed" ? 0 : 1,
    cancelled: false,
    env: {},
    ports: {},
    selected: ["all"],
  };
}

const lines = [{ text: "out", stream: "stdout" as const }];

test("each run is self-contained: run.yaml per run folder, no global index", () => {
  const dir = tempDir();
  const history = new RunHistory(dir);
  const first = history.saveRun(meta(Date.UTC(2026, 0, 1, 10, 0, 0)), [
    { path: "all/one", status: "passed", durationMs: 1, lines },
  ], []);
  const second = history.saveRun(meta(Date.UTC(2026, 0, 2, 10, 0, 0), "failed"), [
    { path: "all/one", status: "failed", durationMs: 2, lines },
  ], []);

  assert.ok(!existsSync(join(dir, ".testfile", "runs.yaml")), "no global index is written");
  const record = parse(
    readFileSync(join(dir, ".testfile", "runs", first.id, "run.yaml"), "utf8")
  ) as RunRecord;
  assert.equal(record.id, first.id);
  assert.equal(record.status, "passed");
  assert.equal(record.tests[0].path, "all/one");

  // a fresh history assembles the index from the run folders, newest first
  const fresh = new RunHistory(dir);
  assert.deepEqual(
    fresh.runs.map((run) => run.id),
    [second.id, first.id]
  );
  assert.equal(fresh.readLog(fresh.runs[1], fresh.runs[1].tests[0]), "out\n");
});

test("a legacy runs.yaml index is migrated into per-run run.yaml files", () => {
  const dir = tempDir();
  const historyDir = join(dir, ".testfile");
  const record = (id: string): RunRecord => ({
    id,
    startedAt: "2026-01-01T00:00:00.000Z",
    durationMs: 1,
    status: "passed",
    exitCode: 0,
    cancelled: false,
    env: {},
    ports: {},
    selected: [],
    tests: [{ path: "all/one", status: "passed", log: join("tests", "one.log") }],
  });
  // one run folder still exists (with its log), the other was never created
  mkdirSync(join(historyDir, "runs", "20260101-000000-aaaa", "tests"), { recursive: true });
  writeFileSync(join(historyDir, "runs", "20260101-000000-aaaa", "tests", "one.log"), "hello\n");
  writeFileSync(
    join(historyDir, "runs.yaml"),
    stringify({ runs: [record("20260102-000000-bbbb"), record("20260101-000000-aaaa")] })
  );

  const history = new RunHistory(dir);
  assert.ok(!existsSync(join(historyDir, "runs.yaml")), "the legacy index is removed");
  assert.deepEqual(
    history.runs.map((run) => run.id),
    ["20260102-000000-bbbb", "20260101-000000-aaaa"]
  );
  assert.equal(history.readLog(history.runs[1], history.runs[1].tests[0]), "hello\n");
  // the migration is complete: a fresh scan sees the same runs
  assert.equal(new RunHistory(dir).runs.length, 2);
});

test("pruning removes the oldest run folders beyond the keep limit", () => {
  const dir = tempDir();
  const history = new RunHistory(dir, 2);
  const runs = [
    history.saveRun(meta(Date.UTC(2026, 0, 1)), [{ path: "a", status: "passed", lines }], []),
    history.saveRun(meta(Date.UTC(2026, 0, 2)), [{ path: "a", status: "passed", lines }], []),
    history.saveRun(meta(Date.UTC(2026, 0, 3)), [{ path: "a", status: "passed", lines }], []),
  ];
  assert.deepEqual(
    history.runs.map((run) => run.id),
    [runs[2].id, runs[1].id]
  );
  assert.deepEqual(readdirSync(join(dir, ".testfile", "runs")).sort(), [runs[1].id, runs[2].id].sort());
  assert.ok(!existsSync(join(dir, ".testfile", "runs", runs[0].id)));
});

test("folders without a readable run.yaml are skipped", () => {
  const dir = tempDir();
  new RunHistory(dir).saveRun(meta(Date.UTC(2026, 0, 1)), [{ path: "a", status: "passed", lines }], []);
  mkdirSync(join(dir, ".testfile", "runs", "not-a-run"), { recursive: true });
  mkdirSync(join(dir, ".testfile", "runs", "broken"), { recursive: true });
  writeFileSync(join(dir, ".testfile", "runs", "broken", "run.yaml"), "");
  const history = new RunHistory(dir);
  assert.equal(history.runs.length, 1);
});
