// Combining several recorded runs into one. Two things produce more than
// one run folder for what is conceptually a single test run:
//
//   - sharding (`testfile start --shard 2/4`), where each shard runs a
//     disjoint part of the suite, and
//   - a matrix of jobs, where every job runs the same suite somewhere else
//     (a platform, a Node version, ...).
//
// The first merges without further ado - no test appears twice. The second
// needs the runs to say what makes them different, which is what a run's
// `variants` are for: two runs may only contribute the same test path when
// their variants differ.
//
// The result is an ordinary run folder: viewers show it like any other run,
// with one status, one duration and the union of the tests. What the merge
// added is recorded, not hidden - `merged.runs` lists the sources and every
// test says which run it came from.
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parse, stringify } from "yaml";
import {
  HISTORY_DIR,
  type RunRecord,
  type RunRecordService,
  type RunRecordTest,
} from "./runrecord.js";

// Written as the first line of a merged run.yaml, like the runner does.
const RUN_SCHEMA_MODELINE =
  "# yaml-language-server: $schema=https://raw.githubusercontent.com/testfile-dev/testfile/main/schema/testrun.schema.json";

export interface MergeSource {
  // The run folder holding run.yaml and the logs.
  dir: string;
  record: RunRecord;
}

// Reads a run folder (…/runs/<id>/) into a merge source.
export function readRunFolder(dir: string): MergeSource {
  const file = join(dir, "run.yaml");
  let record: RunRecord | null;
  try {
    record = parse(readFileSync(file, "utf8")) as RunRecord | null;
  } catch (err) {
    throw new Error(`cannot read ${file}: ${err instanceof Error ? err.message : err}`);
  }
  if (!record || typeof record !== "object" || !Array.isArray(record.tests)) {
    throw new Error(`${file} is not a recorded run`);
  }
  return { dir, record };
}

// "platform=linux, node=22" - stable, sorted by key, for messages and keys.
export function variantLabel(variants: Record<string, string> | undefined): string {
  const entries = Object.entries(variants ?? {}).sort(([a], [b]) => a.localeCompare(b));
  return entries.map(([key, value]) => `${key}=${value}`).join(", ");
}

// Every value seen per key, across the merged runs.
function collectVariants(sources: readonly MergeSource[]): Record<string, string[]> {
  const all: Record<string, Set<string>> = {};
  for (const source of sources) {
    for (const [key, value] of Object.entries(source.record.variants ?? {})) {
      (all[key] ??= new Set()).add(value);
    }
  }
  return Object.fromEntries(
    Object.entries(all)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, values]) => [key, [...values].sort()]),
  );
}

// The entries every source agrees on - those still describe the merged run
// as a whole (a matrix over platforms that all ran on the same node version
// keeps node=22 at the top).
function commonEntries<T>(maps: readonly Record<string, T>[]): Record<string, T> {
  const [first, ...rest] = maps;
  if (!first) return {};
  const out: Record<string, T> = {};
  for (const [key, value] of Object.entries(first)) {
    if (rest.every((map) => map[key] === value)) out[key] = value;
  }
  return out;
}

// The merged verdict: a failure anywhere fails the whole run. Both the
// runs' own verdicts and the merged tests count - a run that says passed
// while carrying a failed test is not going to be reported as green here.
function worstStatus(
  statuses: readonly RunRecord["status"][],
  tests: readonly RunRecordTest[],
): RunRecord["status"] {
  if (statuses.includes("failed") || tests.some((test) => test.status === "failed"))
    return "failed";
  if (statuses.includes("aborted") || tests.some((test) => test.status === "aborted")) {
    return "aborted";
  }
  return "passed";
}

export interface MergedRunInfo {
  runs: {
    id: string;
    variants?: Record<string, string>;
    machine?: string;
    status: RunRecord["status"];
    startedAt: string;
    durationMs: number;
  }[];
  // Every variant value the merged runs used, per key.
  variants?: Record<string, string[]>;
}

// A record's group nodes: a path is a group when another path nests below
// it (spec/RESULTS.md). Groups are scaffolding, not results - every shard
// records the groups around its own tests, so merging combines them
// instead of reporting a clash.
function groupPaths(record: RunRecord): Set<string> {
  const paths = record.tests.map((test) => test.path);
  return new Set(paths.filter((path) => paths.some((other) => other.startsWith(`${path}/`))));
}

// Where a merged run's copy of a source file lives, e.g.
// tests/20260805-100000-a1c3/ci-unit.log. Namespacing by source keeps the
// same test's logs from different legs apart.
function copiedPath(sourceId: string, path: string): string {
  return path.replace(/^(tests|services|artifacts)\//, `$1/${sourceId}/`);
}

export interface MergeResult {
  record: RunRecord;
  // Files to copy: [absolute source, path inside the merged run folder].
  files: [string, string][];
}

// Builds the merged record. Nothing is written - `writeMergedRun` does that.
export function mergeRuns(sources: readonly MergeSource[], id: string): MergeResult {
  if (sources.length < 2) throw new Error("merging needs at least two runs");

  const records = sources.map((source) => source.record);
  const files: [string, string][] = [];
  const tests: RunRecordTest[] = [];
  const services: RunRecordService[] = [];
  // path + variants must be unique: that is what makes a merged run
  // readable as one run. Groups are the exception, see groupPaths.
  const seen = new Map<string, string>();
  // group path + variants -> where its entry sits in `tests`
  const groupIndex = new Map<string, number>();

  for (const { dir, record } of sources) {
    const variants = record.variants;
    const groups = groupPaths(record);
    for (const test of record.tests) {
      const key = `${test.path} ${variantLabel(variants)}`;
      if (groups.has(test.path)) {
        // scaffolding: fold it into the entry the first run contributed
        const at = groupIndex.get(key);
        if (at === undefined) {
          groupIndex.set(key, tests.length);
          tests.push({ ...test, ...(variants ? { variants } : {}) });
        } else {
          const group = tests[at];
          if (test.status === "failed" || group.status === "failed") group.status = "failed";
          else if (test.status === "aborted" || group.status === "aborted")
            group.status = "aborted";
          if (test.durationMs !== undefined) {
            group.durationMs = (group.durationMs ?? 0) + test.durationMs;
          }
          // a group starts when the first of its legs did
          if (test.startedAt && (!group.startedAt || test.startedAt < group.startedAt)) {
            group.startedAt = test.startedAt;
          }
        }
        continue;
      }
      const clash = seen.get(key);
      if (clash !== undefined) {
        const where = variantLabel(variants);
        throw new Error(
          `runs ${clash} and ${record.id} both recorded "${test.path}"` +
            (where ? ` with variants ${where}` : "") +
            ` - give the runs distinct --variant values (e.g. --variant platform=linux)`,
        );
      }
      seen.set(key, record.id);
      const entry: RunRecordTest = { ...test, origin: record.id };
      if (variants) entry.variants = variants;
      if (test.log) {
        entry.log = copiedPath(record.id, test.log);
        files.push([join(dir, test.log), entry.log]);
      }
      if (test.artifacts) {
        entry.artifacts = test.artifacts.map((artifact) => {
          const target = copiedPath(record.id, artifact);
          files.push([join(dir, artifact), target]);
          return target;
        });
      }
      tests.push(entry);
    }
    for (const service of record.services ?? []) {
      const entry: RunRecordService = { ...service, origin: record.id };
      if (variants) entry.variants = variants;
      if (service.log) {
        entry.log = copiedPath(record.id, service.log);
        files.push([join(dir, service.log), entry.log]);
      }
      services.push(entry);
    }
  }

  const status = worstStatus(
    records.map((record) => record.status),
    tests,
  );
  const cancelled = records.some((record) => record.cancelled);
  const merged: MergedRunInfo = {
    runs: records.map((record) => ({
      id: record.id,
      ...(record.variants ? { variants: record.variants } : {}),
      ...(record.machine ? { machine: record.machine } : {}),
      status: record.status,
      startedAt: record.startedAt,
      durationMs: record.durationMs,
    })),
  };
  const allVariants = collectVariants(sources);
  if (Object.keys(allVariants).length > 0) merged.variants = allVariants;

  const common = commonEntries(records.map((record) => record.variants ?? {}));
  // The union of what the legs were labelled with. Where two legs disagree
  // on a key the first one wins: what actually differs between them belongs
  // in `variants`, which is what keeps their results apart.
  const labels: Record<string, string> = {};
  for (const record of records) {
    for (const [key, value] of Object.entries(record.labels ?? {})) {
      if (!(key in labels)) labels[key] = value;
    }
  }
  const startedAt = records.map((r) => r.startedAt).sort()[0];
  // Each leg recorded its offsets against its own start; against the merged
  // start they all land on one timeline, which is what the legs really did.
  const mergedFrom = Date.parse(startedAt);
  for (const test of tests) {
    if (!test.startedAt || Number.isNaN(mergedFrom)) {
      delete test.startedAfterMs;
      continue;
    }
    test.startedAfterMs = Math.max(0, Date.parse(test.startedAt) - mergedFrom);
  }
  const record: RunRecord = {
    id,
    startedAt,
    // total time spent across the merged runs, not their wall-clock span
    durationMs: records.reduce((sum, r) => sum + (r.durationMs ?? 0), 0),
    status,
    exitCode: status === "passed" ? 0 : cancelled && status === "aborted" ? 130 : 1,
    cancelled,
    ...(Object.keys(common).length > 0 ? { variants: common } : {}),
    merged,
    env: commonEntries(records.map((r) => r.env ?? {})),
    ports: commonEntries(records.map((r) => r.ports ?? {})),
    selected: [...new Set(records.flatMap((r) => r.selected ?? []))],
    ...(Object.keys(labels).length > 0 ? { labels } : {}),
    ...(records.find((r) => r.suite)?.suite ? { suite: records.find((r) => r.suite)!.suite } : {}),
    tests,
    ...(services.length > 0 ? { services } : {}),
  };
  return { record, files };
}

// Merges into `baseDir`'s history and returns the new run's id.
export function writeMergedRun(
  baseDir: string,
  sources: readonly MergeSource[],
  id: string,
): { id: string; dir: string; record: RunRecord } {
  const { record, files } = mergeRuns(sources, id);
  const runDir = join(baseDir, HISTORY_DIR, "runs", id);
  mkdirSync(runDir, { recursive: true });
  writeFileSync(join(baseDir, HISTORY_DIR, ".gitignore"), "*\n");
  for (const [from, to] of files) {
    if (!existsSync(from)) continue; // a log the source folder no longer has
    mkdirSync(join(runDir, dirname(to)), { recursive: true });
    cpSync(from, join(runDir, to));
  }
  writeFileSync(
    join(runDir, "run.yaml"),
    `${RUN_SCHEMA_MODELINE}\n${stringify(record, { lineWidth: 0 })}`,
  );
  return { id, dir: runDir, record };
}

// Ids look like the runner's: the earliest start plus a short suffix that
// says this one was merged.
export function mergedRunId(sources: readonly MergeSource[], suffix: string): string {
  const earliest = sources.map((s) => s.record.startedAt).sort()[0] ?? new Date(0).toISOString();
  const stamp = earliest.slice(0, 19).replace(/[-:]/g, "").replace("T", "-");
  return `${stamp}-${suffix}`;
}
