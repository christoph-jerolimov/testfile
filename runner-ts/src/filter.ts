import type { RunRecord } from "./history.js";
import { walk, type RunNode } from "./runtree.js";

export interface TestFilters {
  // --filter: best-guess values matching either the path (substring) or a
  // tag (exact), case-insensitive. Values with ":" are routed to `matrix`
  // by splitGenericFilters before they get here.
  any: string[];
  // --filter-name: case-insensitive substrings matched against the leaf's
  // path (names joined with "/"), so ancestor names match too.
  names: string[];
  // --filter-tags: a leaf matches when it or an ancestor carries any of
  // these tags (case-insensitive).
  tags: string[];
  // --filter-matrix, see parseMatrixFilters.
  matrix: Map<string, Set<string>>;
}

export function hasFilters(filters: TestFilters): boolean {
  return (
    filters.any.length > 0 ||
    filters.names.length > 0 ||
    filters.tags.length > 0 ||
    filters.matrix.size > 0
  );
}

// Sorts the generic --filter values: anything with a ":" is a matrix spec,
// the rest matches names or tags.
export function splitGenericFilters(values: string[]): { nameOrTag: string[]; matrixSpecs: string[] } {
  const nameOrTag: string[] = [];
  const matrixSpecs: string[] = [];
  for (const raw of values) {
    const value = raw.trim();
    if (!value) continue;
    (value.includes(":") ? matrixSpecs : nameOrTag).push(value);
  }
  return { nameOrTag, matrixSpecs };
}

// --filter-tags values: comma separated, trimmed; the flag may repeat.
export function parseTagFilters(specs: string[]): string[] {
  return specs
    .flatMap((spec) => spec.split(","))
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0);
}

// --matrix-filter: "key:value" specs. Repeating the same key ORs its values;
// different keys are ANDed.
export function parseMatrixFilters(specs: string[]): Map<string, Set<string>> {
  const filters = new Map<string, Set<string>>();
  for (const spec of specs) {
    const index = spec.indexOf(":");
    if (index <= 0 || index === spec.length - 1) {
      throw new Error(`invalid matrix filter "${spec}", expected key:value`);
    }
    const key = spec.slice(0, index);
    const value = spec.slice(index + 1);
    const values = filters.get(key);
    if (values) values.add(value);
    else filters.set(key, new Set([value]));
  }
  return filters;
}

// A node passes unless it carries a filtered matrix key with a value that is
// not allowed. Nodes without the key (e.g. outside the matrix) are unaffected.
export function matchesMatrixFilters(node: RunNode, filters: Map<string, Set<string>>): boolean {
  for (const [key, allowed] of filters) {
    const value = node.matrix[key];
    if (value !== undefined && !allowed.has(value)) return false;
  }
  return true;
}

// Tags of the node and all its ancestors, lower-cased.
export function effectiveTags(node: RunNode): Set<string> {
  const tags = new Set<string>();
  for (let n: RunNode | undefined = node; n; n = n.parent) {
    for (const tag of n.def.tags ?? []) tags.add(tag.toLowerCase());
  }
  return tags;
}

// --failed: keeps only leaves that failed (or were aborted) in the given
// recorded run, usually the most recent one.
export function filterByLastFailed(leaves: RunNode[], lastRun: RunRecord | undefined): RunNode[] {
  if (!lastRun) {
    throw new Error("no recorded runs to take failures from (--failed)");
  }
  const failedPaths = new Set(
    lastRun.tests
      .filter((test) => test.status === "failed" || test.status === "aborted")
      .map((test) => test.path)
  );
  return leaves.filter((leaf) => failedPaths.has(leaf.path));
}

// The leaf tests that satisfy all given filters (filters of different kinds
// are ANDed). Selecting these leaves runs exactly the filtered subset; their
// ancestors act as scaffolding.
export function selectLeaves(tree: RunNode, filters: TestFilters): RunNode[] {
  const anyNeedles = filters.any.map((value) => value.toLowerCase());
  const needles = filters.names.map((name) => name.toLowerCase());
  const wantedTags = filters.tags.map((tag) => tag.toLowerCase());
  const leaves: RunNode[] = [];
  walk(tree, (node) => {
    if (node.children.length === 0) leaves.push(node);
  });
  return leaves.filter((leaf) => {
    const path = leaf.path.toLowerCase();
    if (anyNeedles.length > 0) {
      const tags = effectiveTags(leaf);
      if (!anyNeedles.some((needle) => path.includes(needle) || tags.has(needle))) return false;
    }
    if (needles.length > 0 && !needles.some((needle) => path.includes(needle))) return false;
    if (wantedTags.length > 0) {
      const tags = effectiveTags(leaf);
      if (!wantedTags.some((tag) => tags.has(tag))) return false;
    }
    if (filters.matrix.size > 0 && !matchesMatrixFilters(leaf, filters.matrix)) return false;
    return true;
  });
}
