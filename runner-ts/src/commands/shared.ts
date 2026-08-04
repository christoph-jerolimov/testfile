// Helpers shared by the runner's commands: the filter flags, turning them
// into a selection, sharding it, and printing an expanded suite.
import { Command } from "commander";
import { gitChangedSelection, predictCacheHits } from "../cache-predict.js";
import {
  filterByLastFailed,
  hasFilters,
  parseMatrixFilters,
  parseTagFilters,
  selectTests,
  splitGenericFilters,
  type TestFilters,
} from "../filter.js";
import { collectGitChanges } from "../gitchanges.js";
import { walk, type RunTest } from "../runsuite.js";
import { Session } from "../session.js";
import { durationsFrom, parseShard, selectShard } from "../shard.js";
import { color, formatMs } from "../util.js";

export { predictCacheHits };

export const collect = (value: string, previous: string[]) => [...previous, value];

export interface FilterFlags {
  filter: string[];
  filterName: string[];
  filterTags: string[];
  filterMatrix: string[];
  failed: boolean;
  changed: boolean;
  changedSince?: string;
  shard?: string;
}

// --changed narrows a resolved selection to the tests whose `inputs` match
// a file changed against the base branch (committed or dirty in the working
// copy); tests without `inputs` always count as changed. Needs a git
// checkout - see the `changes` command to inspect what it selects from.
export async function applyChanged(
  session: Session,
  filtered: ReturnType<typeof resolveFilters>,
  flags: Pick<FilterFlags, "changed" | "changedSince">
): Promise<ReturnType<typeof resolveFilters>> {
  if (!flags.changed && flags.changedSince === undefined) return filtered;
  const changes = collectGitChanges(session.baseDir, flags.changedSince);
  const { ids, notes } = await gitChangedSelection(session, filtered.active, changes);
  if (ids.length === 0) {
    throw new Error(
      `nothing to run: no selected test has inputs matching the ` +
        `${changes.files.length} changed file${changes.files.length === 1 ? "" : "s"} ` +
        `against ${changes.baseRef} (see: testfile changes)`
    );
  }
  session.selectionNotes = notes;
  console.log(
    color(
      90,
      `--changed: ${ids.length} of ${filtered.testCount} tests selected ` +
        `(${changes.files.length} files changed against ${changes.baseRef})`
    )
  );
  return {
    selection: ids,
    active: session.activeSetFor(ids),
    testCount: ids.length,
    filtered: true,
  };
}

// --shard i/n keeps only this shard's share of the selected leaf tests.
// Every shard computes the same split from the same suite, so no
// coordination is needed; recorded durations make it time-balanced.
export function applyShard(
  session: Session,
  filtered: ReturnType<typeof resolveFilters>,
  spec: string | undefined
): ReturnType<typeof resolveFilters> {
  if (spec === undefined) return filtered;
  const shard = parseShard(spec);
  const leaves: { id: number; path: string }[] = [];
  walk(session.suite, (test) => {
    if (filtered.active.has(test.id) && test.children.length === 0) {
      leaves.push({ id: test.id, path: test.path });
    }
  });
  const durations = durationsFrom(session.history.runs);
  const result = selectShard(leaves, shard, durations);
  if (result.ids.length === 0) {
    throw new Error(
      `--shard ${shard.index}/${shard.total} selects no tests (only ${leaves.length} to distribute)`
    );
  }
  console.log(
    color(
      90,
      `shard ${shard.index}/${shard.total}: ${result.ids.length} of ${leaves.length} tests` +
        (result.balanced ? `, ~${formatMs(result.estimateMs ?? 0)} of recorded work` : "")
    )
  );
  return {
    selection: result.ids,
    active: session.activeSetFor(result.ids),
    testCount: result.ids.length,
    filtered: true,
  };
}

// Turns the filter flags into the selection Session.runSelected expects,
// plus the resulting active set for display.
export function resolveFilters(
  session: Session,
  flags: FilterFlags
): { selection: number[]; active: Set<number>; testCount: number; filtered: boolean } {
  const generic = splitGenericFilters(flags.filter);
  const filters: TestFilters = {
    any: generic.nameOrTag,
    names: flags.filterName,
    tags: parseTagFilters(flags.filterTags),
    matrix: parseMatrixFilters([...flags.filterMatrix, ...generic.matrixSpecs]),
  };
  if (!hasFilters(filters) && !flags.failed) {
    const active = session.activeSetFor([session.suite.id]);
    let testCount = 0;
    for (const id of active) {
      if (session.byId.get(id)?.children.length === 0) testCount++;
    }
    return { selection: [session.suite.id], active, testCount, filtered: false };
  }
  let tests = selectTests(session.suite, filters);
  if (flags.failed) {
    tests = filterByLastFailed(tests, session.history.runs[0]);
    if (tests.length === 0) throw new Error("nothing failed in the last recorded run");
  }
  const selection = tests.map((test) => test.id);
  return { selection, active: session.activeSetFor(selection), testCount: tests.length, filtered: true };
}

// Shared by `list` and `run --dry-run`.
export function printSuite(session: Session, active: Set<number>, annotate?: (test: RunTest) => string): void {
  for (const [name] of Object.entries(session.doc.services ?? {})) {
    console.log(`${color(36, "◆")} service ${name}`);
  }
  walk(session.suite, (test: RunTest) => {
    if (!active.has(test.id)) return;
    const marker = test.children.length > 0 ? color(90, test.kind) : "";
    // Matrix instances share their wrapper's def; print tags only once.
    const tags =
      test.def.tags && test.parent?.def !== test.def
        ? color(90, `[${test.def.tags.join(", ")}]`)
        : "";
    const extra = annotate?.(test) ?? "";
    console.log(`${"  ".repeat(test.depth)}${test.name} ${tags} ${marker}${extra}`.replace(/ +$/, ""));
    for (const [name] of Object.entries(test.def.services ?? {})) {
      if (!test.isMatrixWrapper) {
        console.log(`${"  ".repeat(test.depth + 1)}${color(36, "◆")} service ${name}`);
      }
    }
  });
}

export function addFilterOptions(command: Command): Command {
  return command
    .option("-f, --filter <value>", "only tests matching by name/path, tag, or key:value matrix (repeatable)", collect, [])
    .option("-n, --filter-name <name-or-path>", "only tests whose path contains this (repeatable)", collect, [])
    .option("-t, --filter-tags <tags>", "only tests tagged with any of these comma-separated tags (repeatable)", collect, [])
    .option("-m, --filter-matrix <key:value>", "only matrix instances with this value (repeatable)", collect, [])
    .option("--failed", "only tests that failed in the last recorded run", false)
    .option("--changed", "only tests whose inputs match files changed against the base branch (plus local changes)", false)
    .option("--changed-since <ref>", "base branch/ref for --changed, e.g. origin/main (implies --changed)")
    .option(
      "--shard <i/n>",
      "run only this shard of the selected tests, e.g. 2/4 (time-balanced from the run history)"
    );
}
