import assert from "node:assert/strict";
import { test } from "node:test";
import type { RunRecord } from "./runrecord.js";
import {
  describeFilter,
  filterRuns,
  isEmptyFilter,
  labelOptions,
  parseStatuses,
  runVariantLabels,
  variantOptions,
  type RunFilter,
} from "./runfilter.js";

const empty: RunFilter = { statuses: [], labels: [], variants: [] };

const run = (over: Partial<RunRecord> & { id: string }): RunRecord => ({
  startedAt: "2026-08-01T10:00:00.000Z",
  durationMs: 5,
  status: "passed",
  exitCode: 0,
  cancelled: false,
  env: {},
  ports: {},
  selected: [],
  tests: [],
  ...over,
});

const runs: RunRecord[] = [
  run({ id: "push", labels: { branch: "main", trigger: "push" } }),
  run({
    id: "pr",
    status: "failed",
    exitCode: 1,
    labels: { branch: "fix/x", pr: "42", trigger: "pull_request" },
  }),
  run({
    id: "nightly",
    variants: { platform: "linux" },
    labels: { branch: "main", trigger: "schedule" },
  }),
  run({
    id: "merged",
    status: "aborted",
    merged: {
      runs: [
        {
          id: "leg-linux",
          variants: { platform: "linux" },
          status: "passed",
          startedAt: "2026-08-01T09:00:00.000Z",
          durationMs: 5,
        },
        {
          id: "leg-windows",
          variants: { platform: "windows" },
          status: "failed",
          startedAt: "2026-08-01T09:00:00.000Z",
          durationMs: 5,
        },
      ],
    },
  }),
];

const ids = (filter: Partial<RunFilter>): string[] =>
  filterRuns(runs, { ...empty, ...filter }).map((r) => r.id);

test("an unused filter says nothing rather than nothing-matches", () => {
  assert.ok(isEmptyFilter(empty));
  assert.deepEqual(ids({}), ["push", "pr", "nightly", "merged"]);
  assert.equal(isEmptyFilter({ ...empty, labels: ["branch=main"] }), false);
});

test("several values of one filter are an OR, different filters an AND", () => {
  assert.deepEqual(ids({ statuses: ["failed"] }), ["pr"]);
  assert.deepEqual(ids({ statuses: ["failed", "aborted"] }), ["pr", "merged"]);
  assert.deepEqual(ids({ labels: ["branch=main"], statuses: ["passed"] }), ["push", "nightly"]);
  assert.deepEqual(ids({ labels: ["branch=main"], statuses: ["failed"] }), []);
});

test("a label filter matches a pair exactly, or a bare key as 'is it set'", () => {
  assert.deepEqual(ids({ labels: ["branch=main"] }), ["push", "nightly"]);
  assert.deepEqual(ids({ labels: ["pr=42"] }), ["pr"]);
  assert.deepEqual(ids({ labels: ["pr"] }), ["pr"], "a bare key asks whether it is set at all");
  assert.deepEqual(ids({ labels: ["branch"] }), ["push", "pr", "nightly"]);
  // a value that no run carries, and an unlabelled run
  assert.deepEqual(ids({ labels: ["branch=gone"] }), []);
  assert.deepEqual(ids({ labels: ["trigger=push", "trigger=schedule"] }), ["push", "nightly"]);
});

test("a variant filter also matches the legs of a merged run", () => {
  assert.deepEqual(runVariantLabels(runs[3]), ["platform=linux", "platform=windows"]);
  assert.deepEqual(ids({ variants: ["platform=linux"] }), ["nightly", "merged"]);
  assert.deepEqual(ids({ variants: ["platform=windows"] }), ["merged"]);
  assert.deepEqual(ids({ variants: ["platform=macos"] }), []);
});

test("a run's own results contribute their variants too", () => {
  const tagged = run({
    id: "tagged",
    tests: [{ path: "ci", status: "passed", variants: { node: "22" } }],
  });
  assert.deepEqual(runVariantLabels(tagged), ["node=22"]);
  assert.deepEqual(
    filterRuns([tagged], { ...empty, variants: ["node=22"] }).map((r) => r.id),
    ["tagged"],
  );
});

test("only a real run status is accepted", () => {
  assert.deepEqual(parseStatuses(["passed", "failed", "aborted"]), ["passed", "failed", "aborted"]);
  assert.deepEqual(parseStatuses([]), []);
  assert.throws(() => parseStatuses(["skipped"]), /expects one of passed, failed, aborted/);
  assert.throws(() => parseStatuses(["Passed"]), /got "Passed"/);
});

test("the history's own values are offered when a filter matched nothing", () => {
  assert.deepEqual(labelOptions(runs), [
    "branch=fix/x",
    "branch=main",
    "pr=42",
    "trigger=pull_request",
    "trigger=push",
    "trigger=schedule",
  ]);
  assert.deepEqual(variantOptions(runs), ["platform=linux", "platform=windows"]);
  assert.deepEqual(labelOptions([]), []);
});

test("describeFilter counts what survived", () => {
  assert.equal(describeFilter(3, 12), "3 of 12 runs");
  assert.equal(describeFilter(1, 1), "1 of 1 run");
  assert.equal(describeFilter(0, 4), "0 of 4 runs");
});
