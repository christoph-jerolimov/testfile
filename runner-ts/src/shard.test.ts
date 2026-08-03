import assert from "node:assert/strict";
import { test } from "node:test";
import type { RunRecord } from "./history.js";
import { durationsFrom, parseShard, selectShard, type ShardableTest } from "./shard.js";

const tests: ShardableTest[] = Array.from({ length: 8 }, (_, i) => ({
  id: i + 1,
  path: `suite/test-${i + 1}`,
}));

function allShards(total: number, durations?: Map<string, number>): number[][] {
  return Array.from({ length: total }, (_, i) =>
    selectShard(tests, { index: i + 1, total }, durations).ids
  );
}

test("parseShard accepts i/n and rejects nonsense", () => {
  assert.deepEqual(parseShard("2/4"), { index: 2, total: 4 });
  assert.deepEqual(parseShard(" 1 / 3 "), { index: 1, total: 3 });
  assert.throws(() => parseShard("2"), /must look like 2\/4/);
  assert.throws(() => parseShard("0/3"), /outside 1\.\.3/);
  assert.throws(() => parseShard("4/3"), /outside 1\.\.3/);
  assert.throws(() => parseShard("1/0"), /at least 1/);
});

test("without durations the shards partition the suite round-robin", () => {
  const shards = allShards(4);
  assert.deepEqual(shards, [
    [1, 5],
    [2, 6],
    [3, 7],
    [4, 8],
  ]);
  // every test lands in exactly one shard
  assert.deepEqual(shards.flat().sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.deepEqual(selectShard(tests, { index: 1, total: 1 }).ids, [1, 2, 3, 4, 5, 6, 7, 8]);
});

test("recorded durations balance the shards by time", () => {
  // one very slow test and seven quick ones
  const durations = new Map<string, number>([
    ["suite/test-1", 10_000],
    ["suite/test-2", 1000],
    ["suite/test-3", 1000],
    ["suite/test-4", 1000],
    ["suite/test-5", 1000],
    ["suite/test-6", 1000],
    ["suite/test-7", 1000],
    ["suite/test-8", 1000],
  ]);
  const shards = allShards(2, durations);
  assert.deepEqual(shards.flat().sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7, 8], "still a partition");

  const slow = shards.find((ids) => ids.includes(1))!;
  assert.equal(slow.length, 1, "the slow test gets a shard of its own");
  const other = shards.find((ids) => !ids.includes(1))!;
  assert.equal(other.length, 7);

  const first = selectShard(tests, { index: 1, total: 2 }, durations);
  assert.equal(first.balanced, true);
  assert.equal(typeof first.estimateMs, "number");
});

test("sparse duration data falls back to the round-robin split", () => {
  const durations = new Map<string, number>([["suite/test-1", 5000]]);
  const result = selectShard(tests, { index: 1, total: 4 }, durations);
  assert.equal(result.balanced, false, "one of eight known durations is not enough");
  assert.deepEqual(result.ids, [1, 5]);
});

test("durationsFrom prefers the newest recorded duration per test", () => {
  const runs = [
    { tests: [{ path: "a", status: "passed", durationMs: 200 }] },
    { tests: [{ path: "a", status: "passed", durationMs: 100 }, { path: "b", status: "passed", durationMs: 50 }] },
  ] as unknown as RunRecord[];
  const durations = durationsFrom(runs);
  assert.equal(durations.get("a"), 200, "runs are newest first");
  assert.equal(durations.get("b"), 50);
});
