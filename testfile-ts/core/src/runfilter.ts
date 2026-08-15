// Narrowing a recorded history from the command line, with the same rules
// the web viewer's filter bar uses: several values of one flag are an OR,
// different flags are an AND, and an unused flag says nothing rather than
// nothing-matches.
import type { RunRecord } from "./runrecord.js";

export interface RunFilter {
  // Run statuses to keep, e.g. ["failed"].
  statuses: string[];
  // "branch=main" pairs, or a bare "branch" meaning "has this label".
  labels: string[];
  // "platform=linux" pairs, matched against the run's own variants and,
  // for a merged run, against those of its legs.
  variants: string[];
}

export const RUN_STATUSES = ["passed", "failed", "aborted"];

export function parseStatuses(values: string[]): string[] {
  for (const value of values) {
    if (!RUN_STATUSES.includes(value)) {
      throw new Error(`--filter-status expects one of ${RUN_STATUSES.join(", ")}, got "${value}"`);
    }
  }
  return values;
}

// "platform=linux" for every entry, so a filter value can be compared as a
// whole string - the same shape the web viewer's chips use.
function pairs(map: Record<string, string> | undefined): string[] {
  return Object.entries(map ?? {}).map(([key, value]) => `${key}=${value}`);
}

// Every variant a run carries: its own, each leg of a merged run, and the
// ones its results were tagged with.
export function runVariantLabels(run: RunRecord): string[] {
  const labels = new Set(pairs(run.variants));
  for (const leg of run.merged?.runs ?? []) {
    for (const label of pairs(leg.variants)) labels.add(label);
  }
  for (const test of run.tests) {
    for (const label of pairs(test.variants)) labels.add(label);
  }
  return [...labels];
}

// A filter value matches a label either exactly ("branch=main") or by key
// alone ("branch"), which asks whether the run carries that label at all.
function matchesLabel(run: RunRecord, value: string): boolean {
  const labels = run.labels ?? {};
  if (value.includes("=")) return pairs(labels).includes(value);
  return value in labels;
}

// Nothing selected means "everything", which is what an unused flag should
// do; several values are an OR.
function anyOf(values: readonly string[], match: (value: string) => boolean): boolean {
  return values.length === 0 || values.some(match);
}

export function matchesRunFilter(run: RunRecord, filter: RunFilter): boolean {
  if (!anyOf(filter.statuses, (status) => run.status === status)) return false;
  if (!anyOf(filter.labels, (label) => matchesLabel(run, label))) return false;
  const variants = runVariantLabels(run);
  return anyOf(filter.variants, (variant) => variants.includes(variant));
}

export function filterRuns(runs: readonly RunRecord[], filter: RunFilter): RunRecord[] {
  return runs.filter((run) => matchesRunFilter(run, filter));
}

export function isEmptyFilter(filter: RunFilter): boolean {
  return filter.statuses.length === 0 && filter.labels.length === 0 && filter.variants.length === 0;
}

// What the filters kept, for messages: "3 of 12 runs".
export function describeFilter(kept: number, total: number): string {
  return `${kept} of ${total} run${total === 1 ? "" : "s"}`;
}

// The values a history offers, for the "did you mean" line when a filter
// matched nothing.
export function labelOptions(runs: readonly RunRecord[]): string[] {
  return [...new Set(runs.flatMap((run) => pairs(run.labels)))].sort();
}

export function variantOptions(runs: readonly RunRecord[]): string[] {
  return [...new Set(runs.flatMap(runVariantLabels))].sort();
}
