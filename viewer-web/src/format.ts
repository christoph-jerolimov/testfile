import type { Aggregate, RunRecord } from "./types.js";

export function formatMs(ms?: number): string {
  if (ms === undefined) return "-";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m${Math.round((ms % 60_000) / 1000)}s`;
}

export function startedLabel(iso: string): string {
  return iso.replace("T", " ").slice(0, 19);
}

// "platform=linux, node=22", sorted by key so it never jumps around.
export function variantLabel(variants?: Record<string, string>): string {
  return Object.entries(variants ?? {})
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join(", ");
}

// "platform=linux|macos" - what a merged run combined, per key.
export function mergedVariantLabel(variants?: Record<string, string[]>): string {
  return Object.entries(variants ?? {})
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, values]) => `${key}=${values.join("|")}`)
    .join(", ");
}

export function countSummary(run: RunRecord): string {
  const counts = new Map<string, number>();
  for (const test of run.tests) counts.set(test.status, (counts.get(test.status) ?? 0) + 1);
  return [...counts.entries()].map(([status, n]) => `${n} ${status}`).join(", ");
}

// How flakiness is decided, the same rule `testfile-viewer runs --flaky`
// uses (viewer-ts/src/runrecord.ts). A verdict is only worth anything while
// it is current, so the evidence is bounded twice: by age, and by how many
// results are looked at.
export const FLAKY_DAYS = 14;
export const FLAKY_SAMPLE = 20;
export const FLAKY_FAIL_RATE = 0.25;

export function aggregate(runs: RunRecord[], now: number = Date.now()): Aggregate[] {
  const since = now - FLAKY_DAYS * 24 * 60 * 60 * 1000;
  const byPath = new Map<string, Aggregate>();
  for (const run of runs) {
    const recent = Date.parse(run.startedAt) >= since;
    for (const test of run.tests) {
      let entry = byPath.get(test.path);
      if (!entry) {
        // runs are newest first, so the first occurrence is the latest one
        byPath.set(
          test.path,
          (entry = {
            path: test.path,
            occurrences: 0,
            passes: 0,
            fails: 0,
            lastStatus: test.status,
            history: [],
            recent: [],
          }),
        );
      }
      entry.occurrences++;
      entry.history.push(test.status);
      if (test.status === "passed") entry.passes++;
      if (test.status === "failed" || test.status === "aborted") entry.fails++;
      // `skipped` and `aborted` are not evidence of flakiness: a skip says
      // the test never ran, and one Ctrl+C aborts everything in flight.
      if (
        recent &&
        entry.recent.length < FLAKY_SAMPLE &&
        (test.status === "passed" || test.status === "failed")
      ) {
        entry.recent.push(test.status);
      }
    }
  }
  return [...byPath.values()];
}

// More than a quarter of the sampled results failed.
export function isFlaky(test: Aggregate): boolean {
  if (test.recent.length === 0) return false;
  const fails = test.recent.filter((status) => status === "failed").length;
  return fails / test.recent.length > FLAKY_FAIL_RATE;
}
