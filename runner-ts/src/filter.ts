import { walk, type RunNode } from "./runtree.js";

// --filter: a node matches when its path (names joined with "/", so a bare
// test name works too) contains the value, case-insensitively.
export function findMatchingNodes(tree: RunNode, filters: string[]): RunNode[] {
  const needles = filters.map((f) => f.toLowerCase());
  const matched: RunNode[] = [];
  walk(tree, (node) => {
    const path = node.path.toLowerCase();
    if (needles.some((needle) => path.includes(needle))) matched.push(node);
  });
  return matched;
}

// --matrix-filter: "key:value" specs. Repeating the same key ORs its values;
// different keys are ANDed.
export function parseMatrixFilters(specs: string[]): Map<string, Set<string>> {
  const filters = new Map<string, Set<string>>();
  for (const spec of specs) {
    const index = spec.indexOf(":");
    if (index <= 0 || index === spec.length - 1) {
      throw new Error(`invalid --matrix-filter "${spec}", expected key:value`);
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
