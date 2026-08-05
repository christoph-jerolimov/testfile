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

export function aggregate(runs: RunRecord[]): Aggregate[] {
  const byPath = new Map<string, Aggregate>();
  for (const run of runs) {
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
          }),
        );
      }
      entry.occurrences++;
      entry.history.push(test.status);
      if (test.status === "passed") entry.passes++;
      if (test.status === "failed" || test.status === "aborted") entry.fails++;
    }
  }
  return [...byPath.values()];
}

// A test that both passed and failed across the recorded runs - the same
// rule `testfile-viewer runs --flaky` uses.
export function isFlaky(test: Aggregate): boolean {
  return test.passes > 0 && test.fails > 0;
}
