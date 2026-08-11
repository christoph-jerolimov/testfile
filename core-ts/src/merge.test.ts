import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { writeRun } from "./fixture.js";
import { mergedRunId, mergeRuns, readRunFolder, variantLabel, writeMergedRun } from "./merge.js";
import { RunHistory } from "./runrecord.js";

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "testfile-merge-"));
  process.on("exit", () => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function source(dir: string, id: string) {
  return readRunFolder(join(dir, ".testfile", "runs", id));
}

test("shards merge into one run without variants", () => {
  const dir = tempDir();
  writeRun(dir, "20260101-100000-aa01", "2026-01-01T10:00:00.000Z", [
    { path: "ci/unit", status: "passed", durationMs: 300, log: "unit ok\n" },
  ]);
  writeRun(dir, "20260101-100005-aa02", "2026-01-01T10:00:05.000Z", [
    { path: "ci/e2e", status: "failed", durationMs: 700, log: "e2e boom\n" },
  ]);

  const sources = [source(dir, "20260101-100000-aa01"), source(dir, "20260101-100005-aa02")];
  const { record } = mergeRuns(sources, "merged-1");

  assert.deepEqual(
    record.tests.map((t) => t.path),
    ["ci/unit", "ci/e2e"],
    "the union of the shards, in the order they were given",
  );
  assert.equal(record.status, "failed", "one failed shard fails the merged run");
  assert.equal(record.exitCode, 1);
  assert.equal(record.durationMs, 10, "the merged runs' durations, summed");
  assert.equal(record.startedAt, "2026-01-01T10:00:00.000Z", "the earliest start");
  assert.deepEqual(
    record.merged?.runs.map((r) => r.id),
    ["20260101-100000-aa01", "20260101-100005-aa02"],
  );
  assert.equal(record.merged?.variants, undefined, "no variants were used");
  assert.deepEqual(
    record.tests.map((t) => t.origin),
    ["20260101-100000-aa01", "20260101-100005-aa02"],
    "every test says which run produced it",
  );
});

test("group nodes are folded, not treated as a clash", () => {
  const dir = tempDir();
  // what two shards of the same suite record: each one runs its own leaves
  // but both record the group around them
  writeRun(dir, "20260101-100000-ff01", "2026-01-01T10:00:00.000Z", [
    { path: "ci", status: "passed", durationMs: 400 },
    { path: "ci/a", status: "passed", durationMs: 200 },
  ]);
  writeRun(
    dir,
    "20260101-100005-ff02",
    "2026-01-01T10:00:05.000Z",
    [
      { path: "ci", status: "failed", durationMs: 600 },
      { path: "ci/b", status: "failed", durationMs: 300 },
    ],
    { status: "failed" },
  );

  const { record } = mergeRuns(
    [source(dir, "20260101-100000-ff01"), source(dir, "20260101-100005-ff02")],
    "merged-groups",
  );
  assert.deepEqual(
    record.tests.map((t) => `${t.path}:${t.status}`),
    ["ci:failed", "ci/a:passed", "ci/b:failed"],
    "one group entry, worst status, both leaves",
  );
  assert.equal(record.tests[0].durationMs, 1000, "the group's durations are summed");
  assert.equal(record.tests[0].origin, undefined, "a folded group came from more than one run");
});

test("the same test from two runs needs distinct variants", () => {
  const dir = tempDir();
  writeRun(dir, "20260101-100000-bb01", "2026-01-01T10:00:00.000Z", [
    { path: "ci/unit", status: "passed" },
  ]);
  writeRun(dir, "20260101-100005-bb02", "2026-01-01T10:00:05.000Z", [
    { path: "ci/unit", status: "passed" },
  ]);
  const sources = [source(dir, "20260101-100000-bb01"), source(dir, "20260101-100005-bb02")];
  assert.throws(
    () => mergeRuns(sources, "merged-2"),
    /both recorded "ci\/unit".*distinct --variant/s,
  );
});

test("one job per platform merges into a single run", () => {
  const dir = tempDir();
  for (const [id, platform, status] of [
    ["20260101-100000-cc01", "linux", "passed"],
    ["20260101-100001-cc02", "macos", "passed"],
    ["20260101-100002-cc03", "windows", "failed"],
  ] as const) {
    writeRun(
      dir,
      id,
      `2026-01-01T10:00:0${id.slice(-1)}.000Z`,
      [
        {
          path: "ci/unit",
          status: status === "failed" ? "failed" : "passed",
          log: `${platform}\n`,
        },
      ],
      { status, variants: { platform, node: "22" } },
    );
  }
  const sources = ["20260101-100000-cc01", "20260101-100001-cc02", "20260101-100002-cc03"].map(
    (id) => source(dir, id),
  );
  const { record, files } = mergeRuns(sources, "merged-3");

  assert.equal(record.tests.length, 3, "the same test once per platform");
  assert.deepEqual(
    record.tests.map((t) => t.variants?.platform),
    ["linux", "macos", "windows"],
  );
  assert.deepEqual(record.merged?.variants, {
    node: ["22"],
    platform: ["linux", "macos", "windows"],
  });
  assert.deepEqual(record.variants, { node: "22" }, "what every merged run agreed on stays on top");
  assert.equal(record.status, "failed");
  assert.deepEqual(
    files.map(([, to]) => to),
    [
      "tests/20260101-100000-cc01/0.log",
      "tests/20260101-100001-cc02/0.log",
      "tests/20260101-100002-cc03/0.log",
    ],
    "logs are namespaced by the run they came from",
  );
});

test("writeMergedRun produces a run the viewer reads like any other", () => {
  const dir = tempDir();
  writeRun(
    dir,
    "20260101-100000-dd01",
    "2026-01-01T10:00:00.000Z",
    [{ path: "ci/unit", status: "passed", log: "linux\n" }],
    {
      variants: { platform: "linux" },
      services: [{ name: "db", status: "stopped", log: "ready\n" }],
    },
  );
  writeRun(
    dir,
    "20260101-100001-dd02",
    "2026-01-01T10:00:01.000Z",
    [{ path: "ci/unit", status: "passed", log: "macos\n" }],
    { variants: { platform: "macos" } },
  );

  const target = tempDir();
  const sources = [source(dir, "20260101-100000-dd01"), source(dir, "20260101-100001-dd02")];
  const { id, dir: runDir } = writeMergedRun(target, sources, mergedRunId(sources, "merged"));
  assert.equal(id, "20260101-100000-merged");

  const history = new RunHistory(target);
  const run = history.find(id);
  assert.ok(run, "the merged run shows up in the history");
  assert.equal(run.tests.length, 2);
  assert.equal(history.readLog(run, run.tests[0]), "linux\n");
  assert.equal(history.readLog(run, run.tests[1]), "macos\n");
  assert.equal(history.readServiceLog(run, run.services![0]), "ready\n");
  assert.match(readFileSync(join(runDir, "run.yaml"), "utf8"), /^# yaml-language-server:/);
  assert.ok(existsSync(join(target, ".testfile", ".gitignore")));

  // the assembled run log covers every merged leg
  const log = history.readRunLog(run) ?? "";
  assert.match(log, /linux/);
  assert.match(log, /macos/);
});

test("variantLabel sorts by key and merging needs two runs", () => {
  assert.equal(variantLabel({ platform: "linux", arch: "arm64" }), "arch=arm64, platform=linux");
  assert.equal(variantLabel(undefined), "");
  const dir = tempDir();
  writeRun(dir, "20260101-100000-ee01", "2026-01-01T10:00:00.000Z", [
    { path: "ci/unit", status: "passed" },
  ]);
  assert.throws(() => mergeRuns([source(dir, "20260101-100000-ee01")], "x"), /at least two runs/);
});

test("merging puts every leg's tests on one timeline", () => {
  const dir = tempDir();
  // two jobs that overlap in wall-clock time, each timing itself from its
  // own start
  writeRun(
    dir,
    "20260101-100000-tt01",
    "2026-01-01T10:00:00.000Z",
    [
      {
        path: "ci/unit",
        status: "passed",
        startedAt: "2026-01-01T10:00:02.000Z",
        durationMs: 1000,
      },
    ],
    { variants: { platform: "linux" } },
  );
  writeRun(
    dir,
    "20260101-100010-tt02",
    "2026-01-01T10:00:10.000Z",
    [
      {
        path: "ci/unit",
        status: "passed",
        startedAt: "2026-01-01T10:00:11.000Z",
        durationMs: 1000,
      },
    ],
    { variants: { platform: "windows" } },
  );

  const sources = [source(dir, "20260101-100000-tt01"), source(dir, "20260101-100010-tt02")];
  // each leg recorded its own offset ...
  assert.deepEqual(
    sources.map((s) => s.record.tests[0].startedAfterMs),
    [2000, 1000],
  );

  const { record } = mergeRuns(sources, "merged-timeline");
  assert.equal(record.startedAt, "2026-01-01T10:00:00.000Z");
  // ... and against the merged start they read as what really happened
  assert.deepEqual(
    record.tests.map((t) => t.startedAfterMs),
    [2000, 11_000],
  );
  assert.deepEqual(
    record.tests.map((t) => t.startedAt),
    ["2026-01-01T10:00:02.000Z", "2026-01-01T10:00:11.000Z"],
    "the absolute times are left alone",
  );
});

test("a merged test without a recorded start keeps no offset", () => {
  const dir = tempDir();
  writeRun(dir, "20260101-100000-uu01", "2026-01-01T10:00:00.000Z", [
    { path: "ci/unit", status: "passed" },
  ]);
  writeRun(dir, "20260101-100010-uu02", "2026-01-01T10:00:10.000Z", [
    { path: "ci/e2e", status: "passed", startedAt: "2026-01-01T10:00:12.000Z" },
  ]);
  const { record } = mergeRuns(
    [source(dir, "20260101-100000-uu01"), source(dir, "20260101-100010-uu02")],
    "merged-partial",
  );
  assert.deepEqual(
    record.tests.map((t) => t.startedAfterMs),
    [undefined, 12_000],
  );
});

test("a merged run carries the union of its legs' labels", () => {
  const dir = tempDir();
  writeRun(
    dir,
    "20260101-100000-ll01",
    "2026-01-01T10:00:00.000Z",
    [{ path: "ci/unit", status: "passed" }],
    { variants: { platform: "linux" }, labels: { branch: "main", os: "Linux", pr: "7" } },
  );
  writeRun(
    dir,
    "20260101-100010-ll02",
    "2026-01-01T10:00:10.000Z",
    [{ path: "ci/unit", status: "passed" }],
    { variants: { platform: "windows" }, labels: { branch: "main", os: "Windows", pr: "7" } },
  );
  const { record } = mergeRuns(
    [source(dir, "20260101-100000-ll01"), source(dir, "20260101-100010-ll02")],
    "merged-labels",
  );
  assert.deepEqual(
    record.labels,
    { branch: "main", os: "Linux", pr: "7" },
    "the union; where the legs disagree the first one wins - os belongs in variants",
  );
});

test("merging runs without labels leaves the field out", () => {
  const dir = tempDir();
  writeRun(dir, "20260101-100000-mm01", "2026-01-01T10:00:00.000Z", [
    { path: "ci/unit", status: "passed" },
  ]);
  writeRun(dir, "20260101-100010-mm02", "2026-01-01T10:00:10.000Z", [
    { path: "ci/e2e", status: "passed" },
  ]);
  const { record } = mergeRuns(
    [source(dir, "20260101-100000-mm01"), source(dir, "20260101-100010-mm02")],
    "merged-plain",
  );
  assert.equal(record.labels, undefined);
});
