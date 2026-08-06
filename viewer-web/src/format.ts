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

// How a test's reliability is judged, the same rule
// `testfile-viewer runs --flaky` uses (viewer-ts/src/runrecord.ts). Only the
// FLAKY_SAMPLE most recent results count, and below FLAKY_MIN_RESULTS there
// is not enough evidence to say anything at all.
export const FLAKY_SAMPLE = 20;
export const FLAKY_MIN_RESULTS = 10;
export const FLAKY_MIN_RATE = 0.25;
export const BROKEN_MIN_RATE = 0.75;

export type Verdict = "unknown" | "healthy" | "flaky" | "broken";

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
        entry.recent.length < FLAKY_SAMPLE &&
        (test.status === "passed" || test.status === "failed")
      ) {
        entry.recent.push(test.status);
      }
    }
  }
  return [...byPath.values()];
}

// What the sample says about a test: nothing below FLAKY_MIN_RESULTS, then
// healthy / flaky / broken by how often it failed.
export function verdictOf(test: Aggregate): Verdict {
  if (test.recent.length < FLAKY_MIN_RESULTS) return "unknown";
  const rate = test.recent.filter((status) => status === "failed").length / test.recent.length;
  if (rate > BROKEN_MIN_RATE) return "broken";
  return rate >= FLAKY_MIN_RATE ? "flaky" : "healthy";
}

export function isFlaky(test: Aggregate): boolean {
  return verdictOf(test) === "flaky";
}

export function isBroken(test: Aggregate): boolean {
  return verdictOf(test) === "broken";
}
