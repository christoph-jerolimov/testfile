import type { RunRecord } from "./history.js";

// Splitting a suite across machines: `--shard 2/4` runs the second quarter
// of the selected leaf tests. Every shard sees the same suite and the same
// filters, so the split is deterministic without any coordination between
// them. When the run history knows how long tests took, the split balances
// by time instead of by count - which is what keeps four shards finishing
// at roughly the same moment.

export interface ShardSpec {
  index: number; // 1-based
  total: number;
}

export function parseShard(value: string): ShardSpec {
  const match = /^(\d+)\s*\/\s*(\d+)$/.exec(value.trim());
  if (!match) throw new Error(`--shard must look like 2/4, got "${value}"`);
  const index = Number.parseInt(match[1], 10);
  const total = Number.parseInt(match[2], 10);
  if (total < 1) throw new Error("--shard: the number of shards must be at least 1");
  if (index < 1 || index > total) {
    throw new Error(`--shard: index ${index} is outside 1..${total}`);
  }
  return { index, total };
}

export interface ShardableTest {
  id: number;
  path: string;
}

// Known durations per test path, newest run wins.
export function durationsFrom(runs: readonly RunRecord[]): Map<string, number> {
  const durations = new Map<string, number>();
  // oldest first, so newer runs overwrite older numbers
  for (const run of [...runs].reverse()) {
    for (const test of run.tests) {
      if (test.durationMs !== undefined) durations.set(test.path, test.durationMs);
    }
  }
  return durations;
}

export interface ShardResult {
  ids: number[];
  // Whether recorded durations were used (vs. a plain round-robin split).
  balanced: boolean;
  // Estimated milliseconds of work in this shard, when balancing.
  estimateMs?: number;
}

// Picks the tests belonging to one shard. With durations available, the
// tests are sorted longest-first and greedily handed to the shard with the
// least work so far (LPT scheduling) - a simple heuristic that is within
// 4/3 of the optimum. Without durations, tests are dealt round-robin in
// suite order, which keeps neighbouring tests apart.
export function selectShard(
  tests: readonly ShardableTest[],
  shard: ShardSpec,
  durations?: Map<string, number>
): ShardResult {
  if (shard.total === 1) return { ids: tests.map((test) => test.id), balanced: false };

  const known = durations ? tests.filter((test) => durations.has(test.path)).length : 0;
  // Balancing only helps when most tests have a recorded duration.
  const balanced = known > 0 && known >= tests.length / 2;

  if (!balanced) {
    const ids = tests.filter((_, i) => i % shard.total === shard.index - 1).map((test) => test.id);
    return { ids, balanced: false };
  }

  const median = medianOf([...(durations ?? new Map()).values()]);
  const weighted = tests.map((test, order) => ({
    test,
    order,
    // tests without a recorded duration are assumed average
    weight: durations!.get(test.path) ?? median,
  }));
  // longest first; ties keep suite order so the split stays deterministic
  weighted.sort((a, b) => b.weight - a.weight || a.order - b.order);

  const buckets = Array.from({ length: shard.total }, () => ({ total: 0, ids: [] as number[] }));
  for (const entry of weighted) {
    let target = buckets[0];
    for (const bucket of buckets) {
      if (bucket.total < target.total) target = bucket;
    }
    target.total += entry.weight;
    target.ids.push(entry.test.id);
  }
  const picked = buckets[shard.index - 1];
  return { ids: picked.ids, balanced: true, estimateMs: Math.round(picked.total) };
}

function medianOf(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}
