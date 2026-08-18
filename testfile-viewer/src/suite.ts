// Turning a run into the rows of a collapsible tree.
//
// `run.yaml` records the whole Testfile as `suite`: every node with its kind,
// its tags, the matrix combination it was expanded from and the services it
// declares - including tests a filter kept out of this run. The results in
// `tests[]` are matched onto that tree, so a run shows what the suite is and
// what happened to each part of it, instead of a flat list of what ran.
//
// Records written before `suite` existed (and merged runs, whose suite is the
// one of the first leg) still work: paths that have no node in the tree are
// appended in the order they were recorded.
import type { RunRecord, RunService, RunTest, SuiteNode } from "./types.js";

export interface TreeRow {
  path: string;
  name: string;
  depth: number;
  kind?: string;
  tags?: string[];
  matrix?: Record<string, string>;
  services?: string[];
  // Every recorded result for this path - more than one in a merged run,
  // where each leg contributes its own.
  results: RunTest[];
  // A group is a row with children; only groups can be collapsed.
  hasChildren: boolean;
  // In the suite but with no result: a filter, a condition or a failure
  // earlier in the run kept it from running.
  notRun: boolean;
}

function resultsByPath(tests: readonly RunTest[]): Map<string, RunTest[]> {
  const byPath = new Map<string, RunTest[]>();
  for (const test of tests) {
    const known = byPath.get(test.path);
    if (known) known.push(test);
    else byPath.set(test.path, [test]);
  }
  return byPath;
}

// The tree of the recorded suite, or - for a record without one - the tree
// the test paths imply.
function suiteRows(node: SuiteNode, depth: number, results: Map<string, RunTest[]>): TreeRow[] {
  const children = node.children ?? [];
  const row: TreeRow = {
    path: node.path,
    name: node.name,
    depth,
    kind: node.kind,
    ...(node.tags && node.tags.length > 0 ? { tags: node.tags } : {}),
    ...(node.matrix ? { matrix: node.matrix } : {}),
    ...(node.services && node.services.length > 0 ? { services: node.services } : {}),
    results: results.get(node.path) ?? [],
    hasChildren: children.length > 0,
    notRun: !results.has(node.path),
  };
  return [row, ...children.flatMap((child) => suiteRows(child, depth + 1, results))];
}

// Paths recorded without a matching suite node, nested by their path.
function pathRows(paths: readonly string[], results: Map<string, RunTest[]>): TreeRow[] {
  return paths.map((path) => {
    const segments = path.split("/");
    return {
      path,
      name: segments[segments.length - 1] ?? path,
      depth: segments.length - 1,
      results: results.get(path) ?? [],
      hasChildren: paths.some((other) => other.startsWith(`${path}/`)),
      notRun: false,
    };
  });
}

export function suiteRowsOf(run: RunRecord): TreeRow[] {
  const results = resultsByPath(run.tests);
  if (!run.suite) return pathRows([...new Set(run.tests.map((test) => test.path))], results);
  const rows = suiteRows(run.suite, 0, results);
  const known = new Set(rows.map((row) => row.path));
  // a merged run keeps the suite of one leg; the others' paths land here
  const extra = [...new Set(run.tests.map((test) => test.path))].filter((path) => !known.has(path));
  return [...rows, ...pathRows(extra, results)];
}

// Which rows to show, given the collapsed groups. Collapsing a group hides
// everything below it, however deep.
export function visibleRows(rows: readonly TreeRow[], collapsed: ReadonlySet<string>): TreeRow[] {
  const hidden = [...collapsed];
  return rows.filter((row) => !hidden.some((path) => row.path.startsWith(`${path}/`)));
}

// Groups whose subtree contains no result at all: collapsing those by
// default keeps a suite where one branch ran from filling the screen.
export function groupPaths(rows: readonly TreeRow[]): string[] {
  return rows.filter((row) => row.hasChildren).map((row) => row.path);
}

export function serviceRows(run: RunRecord): RunService[] {
  return run.services ?? [];
}

// The services whose logs belong on a test's page: the ones declared on the
// test's suite node or any ancestor. Runs without a recorded tree relate
// every service - too many tabs beats missing ones.
export function relatedServices(run: RunRecord, path: string): RunService[] {
  const services = run.services ?? [];
  if (services.length === 0 || !run.suite) return services;
  const declared = new Set<string>();
  let found = false;
  const walk = (node: SuiteNode, prefixMatches: boolean): void => {
    const onPath = prefixMatches && (path === node.path || path.startsWith(`${node.path}/`));
    if (onPath) for (const name of node.services ?? []) declared.add(name);
    if (node.path === path) found = true;
    for (const child of node.children ?? []) walk(child, onPath);
  };
  walk(run.suite, true);
  if (!found || declared.size === 0) return services;
  return services.filter((service) => declared.has(service.name));
}
