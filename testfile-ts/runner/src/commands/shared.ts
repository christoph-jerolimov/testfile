// Helpers shared by the runner's commands: the filter flags, turning them
// into a selection, sharding it, and printing an expanded suite.
import { writeFileSync } from "node:fs";
import { Command } from "commander";
import {
  collectGitChanges,
  color,
  durationsFrom,
  filterByLastFailed,
  formatMs,
  gitChangedSelection,
  hasFilters,
  parseMatrixFilters,
  parseShard,
  parseTagFilters,
  predictCacheHits,
  type RunTest,
  selectShard,
  selectTests,
  Session,
  splitGenericFilters,
  type TestFilters,
  walk,
} from "../index.js";

export { predictCacheHits };

// Machine-readable output for the commands that offer --json: a named file,
// or stdout when the flag is given without a value. `noun` names what was
// written, so the confirmation reads "tags written to file.json".
export function writeJson(data: unknown, target: string | true, noun: string): void {
  const json = `${JSON.stringify(data, null, 2)}\n`;
  if (typeof target === "string") {
    writeFileSync(target, json);
    console.log(color(90, `${noun} written to ${target}`));
  } else {
    process.stdout.write(json);
  }
}

// `--json` without a value is `true`; absent is `undefined` or `false`.
export function wantsJson(value: string | boolean | undefined): value is string | true {
  return value !== undefined && value !== false;
}

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
  flags: Pick<FilterFlags, "changed" | "changedSince">,
): Promise<ReturnType<typeof resolveFilters>> {
  if (!flags.changed && flags.changedSince === undefined) return filtered;
  const changes = collectGitChanges(session.baseDir, flags.changedSince);
  const { ids, notes } = await gitChangedSelection(session, filtered.active, changes);
  if (ids.length === 0) {
    throw new Error(
      `nothing to run: no selected test has inputs matching the ` +
        `${changes.files.length} changed file${changes.files.length === 1 ? "" : "s"} ` +
        `against ${changes.baseRef} (see: testfile changes)`,
    );
  }
  session.selectionNotes = notes;
  console.log(
    color(
      90,
      `--changed: ${ids.length} of ${filtered.testCount} tests selected ` +
        `(${changes.files.length} files changed against ${changes.baseRef})`,
    ),
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
  spec: string | undefined,
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
      `--shard ${shard.index}/${shard.total} selects no tests (only ${leaves.length} to distribute)`,
    );
  }
  console.log(
    color(
      90,
      `shard ${shard.index}/${shard.total}: ${result.ids.length} of ${leaves.length} tests` +
        (result.balanced ? `, ~${formatMs(result.estimateMs ?? 0)} of recorded work` : ""),
    ),
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
  flags: FilterFlags,
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
  return {
    selection,
    active: session.activeSetFor(selection),
    testCount: tests.length,
    filtered: true,
  };
}

// Shared by `inspect` and `start --dry-run`.
// What `inspect --json` writes: the selected tests in execution order, flat,
// with the path carrying the nesting - the same key `run.yaml`'s tests[]
// uses, so the two read alike.
export interface SuiteEntry {
  path: string;
  name: string;
  kind: string;
  tags?: string[];
  matrix?: Record<string, string>;
  services?: string[];
}

export function suiteJson(session: Session, active: Set<number>): SuiteEntry[] {
  const entries: SuiteEntry[] = [];
  walk(session.suite, (test: RunTest) => {
    if (!active.has(test.id)) return;
    const entry: SuiteEntry = { path: test.path, name: test.name, kind: test.kind };
    // Matrix instances share their wrapper's definition; its tags and
    // services are listed once, on the wrapper.
    if (test.def.tags?.length && test.parent?.def !== test.def) entry.tags = [...test.def.tags];
    if (Object.keys(test.matrix).length > 0) entry.matrix = { ...test.matrix };
    const services = Object.keys(test.def.services ?? {});
    if (services.length > 0 && !test.isMatrixWrapper) entry.services = services;
    entries.push(entry);
  });
  return entries;
}

export function printSuite(
  session: Session,
  active: Set<number>,
  annotate?: (test: RunTest) => string,
): void {
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
    console.log(
      `${"  ".repeat(test.depth)}${test.name} ${tags} ${marker}${extra}`.replace(/ +$/, ""),
    );
    for (const [name] of Object.entries(test.def.services ?? {})) {
      if (!test.isMatrixWrapper) {
        console.log(`${"  ".repeat(test.depth + 1)}${color(36, "◆")} service ${name}`);
      }
    }
  });
}

export function addFilterOptions(command: Command): Command {
  return command
    .option(
      "-f, --filter <value>",
      "only tests matching by name/path, tag, or key:value matrix (repeatable)",
      collect,
      [],
    )
    .option(
      "-n, --filter-name <name-or-path>",
      "only tests whose path contains this (repeatable)",
      collect,
      [],
    )
    .option(
      "-t, --filter-tags <tags>",
      "only tests tagged with any of these comma-separated tags (repeatable)",
      collect,
      [],
    )
    .option(
      "-m, --filter-matrix <key:value>",
      "only matrix instances with this value (repeatable)",
      collect,
      [],
    )
    .option("--failed", "only tests that failed in the last recorded run", false)
    .option(
      "--changed",
      "only tests whose inputs match files changed against the base branch (plus local changes)",
      false,
    )
    .option(
      "--changed-since <ref>",
      "base branch/ref for --changed, e.g. origin/main (implies --changed)",
    )
    .option(
      "--shard <i/n>",
      "run only this shard of the selected tests, e.g. 2/4 (time-balanced from the run history)",
    );
}
