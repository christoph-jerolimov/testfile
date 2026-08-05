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

test("reload picks up runs recorded by another process", () => {
  const dir = tempDir();
  const history = new RunHistory(dir);
  assert.equal(history.runs.length, 0);
  const other = new RunHistory(dir);
  const saved = other.saveRun(meta(Date.UTC(2026, 0, 5)), [{ path: "a", status: "passed", lines }], []);
  assert.equal(history.runs.length, 0, "not visible before reload");
  history.reload();
  assert.deepEqual(
    history.runs.map((run) => run.id),
    [saved.id]
  );
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

test("service logs are persisted per service and appear in the merged log", () => {
  const dir = tempDir();
  const history = new RunHistory(dir);
  const run = history.saveRun(
    meta(Date.UTC(2026, 0, 6)),
    [{ path: "all", status: "passed", durationMs: 1, lines }],
    [
      { name: "db", status: "stopped", lines: [{ text: "ready to accept connections", stream: "stdout" }] },
      { name: "quiet", status: "stopped", lines: [] },
    ]
  );
  assert.equal(run.services?.length, 2);
  assert.equal(run.services?.[0].log, "services/db-" + run.services[0].log!.split("-").pop());
  assert.equal(run.services?.[1].log, undefined, "no log entry without output");

  const fresh = new RunHistory(dir);
  const loaded = fresh.find(run.id)!;
  assert.equal(fresh.readServiceLog(loaded, loaded.services![0]), "ready to accept connections\n");
  const merged = fresh.readRunLog(loaded) ?? "";
  assert.match(merged, /=== service db \(stopped\) ===/);
  assert.match(merged, /ready to accept connections/);
  assert.match(merged, /=== service quiet \(stopped\) ===/);
});

test("every run folder contains a junit.xml built from the record", () => {
  const dir = tempDir();
  const run = new RunHistory(dir).saveRun(
    { ...meta(Date.UTC(2026, 0, 7), "failed"), name: "demo" },
    [
      { path: "all", status: "failed", durationMs: 9, lines: [] },
      { path: "all/good", status: "passed", durationMs: 3, lines },
      { path: "all/bad", status: "failed", durationMs: 4, lines: [{ text: "boom", stream: "stderr" }] },
      { path: "all/off", status: "skipped", lines: [] },
    ],
    []
  );
  assert.equal(run.junit, "junit.xml");
  const xml = readFileSync(join(dir, ".testfile", "runs", run.id, "junit.xml"), "utf8");
  assert.match(xml, /<testsuites name="demo" tests="3" failures="1" skipped="1"/);
  assert.match(xml, /<testcase name="good" classname="all" time="0.003"\/>/);
  assert.match(xml, /<failure message="failed">boom/);
  assert.match(xml, /<skipped\/>/);
  assert.ok(!xml.includes('name="all" classname="all"'), "the group node is not a testcase");
});

test("run.yaml records the Testfile's tree, tags and matrix combinations", async () => {
  const { Session } = await import("./session.js");
  const dir = tempDir();
  const session = new Session(
    {
      version: 0,
      test: {
        name: "root",
        sequence: [
          { name: "lint", tags: ["fast"], command: "true" },
          {
            name: "checks",
            tags: ["slow"],
            parallel: [
              { name: "unit", command: "true" },
              {
                name: "db ${{ matrix.db }}",
                matrix: { db: ["pg", "mysql"] },
                services: { database: { command: "sleep 30", ready: { log: "x" } } },
                command: "true",
              },
            ],
          },
        ],
      },
    },
    dir
  );
  // only one test runs; the recorded tree still describes the whole file
  await session.runSelected([[...session.byId.values()].find((t) => t.name === "lint")!.id]);

  const suite = session.lastRecord!.suite!;
  assert.equal(suite.path, "root");
  assert.equal(suite.kind, "sequence");
  assert.deepEqual(suite.children!.map((child) => child.name), ["lint", "checks"]);
  assert.deepEqual(suite.children![0].tags, ["fast"], "own tags are recorded");

  const checks = suite.children![1];
  assert.equal(checks.kind, "parallel");
  assert.deepEqual(checks.tags, ["slow"]);
  const wrapper = checks.children!.find((child) => child.kind === "matrix")!;
  assert.deepEqual(
    wrapper.children!.map((instance) => instance.matrix),
    [{ db: "pg" }, { db: "mysql" }],
    "every matrix instance carries its combination"
  );
  assert.deepEqual(wrapper.children![0].services, ["database"], "declared services are listed");
  // the filtered-out tests are in the tree but not in the results
  assert.deepEqual(
    session.lastRecord!.tests.map((entry) => entry.path),
    ["root", "root/lint"]
  );

  // and it survives a round trip through the recorded file
  const reloaded = new RunHistory(dir).runs[0];
  assert.deepEqual(reloaded.suite, suite);
});

test("variants are recorded when the run was given some", () => {
  const dir = mkdtempSync(join(tmpdir(), "testfile-history-"));
  const history = new RunHistory(dir);
  const record = history.saveRun(
    {
      startedAtMs: Date.parse("2026-01-01T10:00:00.000Z"),
      durationMs: 5,
      status: "passed",
      exitCode: 0,
      cancelled: false,
      variants: { platform: "linux", node: "22" },
      env: {},
      ports: {},
      selected: [],
    },
    [{ path: "all", status: "passed", lines: [] }],
    []
  );
  assert.deepEqual(record.variants, { platform: "linux", node: "22" });
  const written = parse(readFileSync(join(dir, ".testfile", "runs", record.id, "run.yaml"), "utf8"));
  assert.deepEqual(written.variants, { platform: "linux", node: "22" });

  // no variants, no field: a plain run's record stays as it was
  const plain = history.saveRun(
    {
      startedAtMs: Date.parse("2026-01-01T10:00:01.000Z"),
      durationMs: 5,
      status: "passed",
      exitCode: 0,
      cancelled: false,
      variants: {},
      env: {},
      ports: {},
      selected: [],
    },
    [{ path: "all", status: "passed", lines: [] }],
    []
  );
  assert.equal(plain.variants, undefined);
});
