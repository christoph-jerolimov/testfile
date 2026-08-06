// Filtering the two tables. Everything here is pure: the components own the
// filter state, these functions turn it into the rows to show.
//
// The defaults are chosen so the viewer opens on what is being worked on:
// the last 30 days of runs, every status, every tag. A multi-select with
// nothing selected means "no opinion" - it shows everything rather than
// nothing, which is what an empty filter should do.
import { isFlaky } from "./format.js";
import type { Aggregate, RunRecord, SuiteNode } from "./types.js";

export interface RunFilter {
  // How far back "started" reaches; 0 means the whole history.
  days: number;
  statuses: string[];
  // Variant labels ("platform=linux"), matched against the run's own
  // variants and, for a merged run, against those of its legs.
  variants: string[];
  // The run's own labels as "branch=main" pairs, matched for equality.
  labels: string[];
  text: string;
}

export interface TestFilter {
  statuses: string[];
  tags: string[];
  text: string;
  // Only tests that both passed and failed across the recorded runs.
  flakyOnly: boolean;
}

export const DEFAULT_DAYS = 30;

export const runFilterDefaults: RunFilter = {
  days: DEFAULT_DAYS,
  statuses: [],
  variants: [],
  labels: [],
  text: "",
};

export const testFilterDefaults: TestFilter = {
  statuses: [],
  tags: [],
  text: "",
  flakyOnly: false,
};

export function isDefaultRunFilter(filter: RunFilter): boolean {
  return (
    filter.days === DEFAULT_DAYS &&
    filter.statuses.length === 0 &&
    filter.variants.length === 0 &&
    filter.labels.length === 0 &&
    filter.text === ""
  );
}

export function isDefaultTestFilter(filter: TestFilter): boolean {
  return (
    filter.statuses.length === 0 &&
    filter.tags.length === 0 &&
    filter.text === "" &&
    !filter.flakyOnly
  );
}

// "platform=linux, node=22" as separate labels, so each one can be picked.
function variantLabels(variants?: Record<string, string>): string[] {
  return Object.entries(variants ?? {}).map(([key, value]) => `${key}=${value}`);
}

// Every variant a run carries: its own, plus each leg of a merged run.
export function runVariantLabels(run: RunRecord): string[] {
  const labels = new Set(variantLabels(run.variants));
  for (const leg of run.merged?.runs ?? []) {
    for (const label of variantLabels(leg.variants)) labels.add(label);
  }
  for (const test of run.tests) {
    for (const label of variantLabels(test.variants)) labels.add(label);
  }
  return [...labels];
}

// The values a filter can offer, in a stable order.
export function variantOptions(runs: readonly RunRecord[]): string[] {
  return [...new Set(runs.flatMap(runVariantLabels))].sort();
}

// A run's labels as pickable "branch=main" strings.
export function runLabels(run: RunRecord): string[] {
  return variantLabels(run.labels);
}

// Every label any recorded run carries, in a stable order.
export function labelOptions(runs: readonly RunRecord[]): string[] {
  return [...new Set(runs.flatMap(runLabels))].sort();
}

export function statusOptions(runs: readonly RunRecord[]): string[] {
  return [...new Set(runs.map((run) => run.status))].sort();
}

export function testStatusOptions(tests: readonly Aggregate[]): string[] {
  return [...new Set(tests.map((test) => test.lastStatus))].sort();
}

function walkSuite(node: SuiteNode, visit: (node: SuiteNode) => void): void {
  visit(node);
  for (const child of node.children ?? []) walkSuite(child, visit);
}

// The tags of each test path, taken from the recorded suite trees. A test
// inherits the tags of its groups, exactly as the runner applies them.
export function tagsByPath(runs: readonly RunRecord[]): Map<string, string[]> {
  const tags = new Map<string, Set<string>>();
  for (const run of runs) {
    if (!run.suite) continue;
    const inherited = new Map<string, string[]>();
    walkSuite(run.suite, (node) => {
      const parent = node.path.includes("/")
        ? (inherited.get(node.path.slice(0, node.path.lastIndexOf("/"))) ?? [])
        : [];
      const own = [...parent, ...(node.tags ?? [])];
      inherited.set(node.path, own);
      if (own.length > 0) {
        const known = tags.get(node.path) ?? new Set<string>();
        for (const tag of own) known.add(tag);
        tags.set(node.path, known);
      }
    });
  }
  return new Map([...tags].map(([path, set]) => [path, [...set].sort()]));
}

export function tagOptions(runs: readonly RunRecord[]): string[] {
  return [...new Set([...tagsByPath(runs).values()].flat())].sort();
}

// Nothing selected means "everything", which is what an untouched
// multi-select should do.
function selected(values: readonly string[], candidates: readonly string[]): boolean {
  return values.length === 0 || candidates.some((candidate) => values.includes(candidate));
}

function matches(text: string, haystack: readonly (string | undefined)[]): boolean {
  if (!text) return true;
  const needle = text.toLowerCase();
  return haystack.some((entry) => entry?.toLowerCase().includes(needle));
}

export function filterRuns(
  runs: readonly RunRecord[],
  filter: RunFilter,
  now: number = Date.now(),
): RunRecord[] {
  const since = filter.days > 0 ? now - filter.days * 24 * 60 * 60 * 1000 : undefined;
  return runs.filter((run) => {
    if (since !== undefined && Date.parse(run.startedAt) < since) return false;
    if (!selected(filter.statuses, [run.status])) return false;
    if (!selected(filter.variants, runVariantLabels(run))) return false;
    if (!selected(filter.labels, runLabels(run))) return false;
    return matches(filter.text, [
      run.id,
      run.status,
      ...run.selected,
      ...runVariantLabels(run),
      ...runLabels(run),
      ...run.tests.map((test) => test.path),
    ]);
  });
}

export function filterTests(
  tests: readonly Aggregate[],
  filter: TestFilter,
  tags: Map<string, string[]> = new Map(),
): Aggregate[] {
  return tests.filter((test) => {
    if (filter.flakyOnly && !isFlaky(test)) return false;
    if (!selected(filter.statuses, [test.lastStatus])) return false;
    if (!selected(filter.tags, tags.get(test.path) ?? [])) return false;
    return matches(filter.text, [test.path, test.lastStatus, ...(tags.get(test.path) ?? [])]);
  });
}
