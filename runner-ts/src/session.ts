import { EventEmitter } from "node:events";
import { globSync, statSync } from "node:fs";
import { join } from "node:path";
import { ResultCache } from "./cache.js";
import { maskSecrets } from "./envfile.js";
import { Runner } from "./executor.js";
import { detectMachine } from "./machine.js";
import type { OutputLine } from "./output.js";
import {
  RunHistory,
  type RunLogInput,
  type RunRecord,
  type RunRecordSuiteNode,
} from "./history.js";
import { validateSemantics } from "./loader.js";
import type { TestfileDoc } from "./model.js";
import { buildRunSuite, resetTest, walk, type RunTest, type Status } from "./runsuite.js";

// Owns the test suite, run history and the (re)creation of Runners, so the
// TUI and the CLI can run the suite - or a selected part of it - repeatedly.
// Events: "update" (state changed), "runner" (a new Runner was created).
export class Session extends EventEmitter {
  readonly suite: RunTest;
  readonly history: RunHistory;
  readonly byId = new Map<number, RunTest>();
  runner?: Runner;
  running = false;
  lastRecord?: RunRecord;
  // The selection of the most recent run, e.g. for watch-mode re-runs.
  lastSelection?: number[];
  // Why the current selection picked each test (set by --changed); passed
  // to the Runner so the notes land in logs and run records.
  selectionNotes?: Map<number, string>;

  constructor(
    readonly doc: TestfileDoc,
    readonly baseDir: string,
    // Defaults applied to every run started from this session (CLI flags
    // like --fail-fast / --max-parallel, honored by TUI-started runs too).
    readonly runDefaults: {
      failFast?: boolean;
      maxParallel?: number;
      noCache?: boolean;
      forwardEnv?: string[];
      // Recorded with the run, e.g. { platform: linux } - see --variant.
      variants?: Record<string, string>;
    } = {},
  ) {
    super();
    validateSemantics(doc);
    this.suite = buildRunSuite(doc);
    walk(this.suite, (test) => this.byId.set(test.id, test));
    this.history = new RunHistory(baseDir);
    this.cache = new ResultCache(baseDir, !(runDefaults.noCache ?? false));
  }

  readonly cache: ResultCache;

  // A selected test runs with all its nested tests; ancestors run as scaffolding
  // (their sequence/parallel semantics and services still apply).
  activeSetFor(selection: Iterable<number>): Set<number> {
    const active = new Set<number>();
    for (const id of selection) {
      const test = this.byId.get(id);
      if (!test) continue;
      walk(test, (n) => active.add(n.id));
      for (let parent = test.parent; parent; parent = parent.parent) active.add(parent.id);
    }
    return active;
  }

  async runSelected(
    selection: Iterable<number>,
    options: { exclude?: (test: RunTest) => boolean } = {},
  ): Promise<Status | undefined> {
    if (this.running) return undefined;
    const selectedIds = [...selection];
    const active = this.activeSetFor(selectedIds);
    if (options.exclude) {
      // iterate over a copy: the loop deletes from `active`
      // oxlint-disable-next-line no-useless-spread
      for (const id of [...active]) {
        const test = this.byId.get(id);
        if (test && options.exclude(test)) active.delete(id);
      }
    }
    if (active.size === 0) return undefined;
    this.lastSelection = selectedIds;

    walk(this.suite, (test) => {
      if (active.has(test.id)) resetTest(test);
    });
    const runner = new Runner(this.doc, this.suite, this.baseDir, {
      active,
      failFast: this.runDefaults.failFast,
      maxParallel: this.runDefaults.maxParallel,
      cache: this.cache,
      forwardEnv: this.runDefaults.forwardEnv,
      selectionNotes: this.selectionNotes,
    });
    this.runner = runner;
    runner.on("update", () => this.emit("update"));
    this.emit("runner", runner);
    this.running = true;
    this.emit("update");

    const startedAtMs = Date.now();
    let status: Status;
    try {
      status = await runner.run();
    } finally {
      this.running = false;
    }
    this.cache.flush();
    this.persist(runner, active, selectedIds, status, startedAtMs, Date.now() - startedAtMs);
    this.emit("update");
    return status;
  }

  runAll(): Promise<Status | undefined> {
    return this.runSelected([this.suite.id]);
  }

  private persist(
    runner: Runner,
    active: Set<number>,
    selectedIds: number[],
    status: Status,
    startedAtMs: number,
    durationMs: number,
  ): void {
    // Values loaded from env files never reach the recorded logs or record.
    const secrets = [...runner.secrets].filter((secret) => secret.length >= 4);
    const mask = (lines: OutputLine[]): OutputLine[] =>
      secrets.length === 0
        ? lines
        : lines.map((line) => ({ ...line, text: maskSecrets(line.text, secrets) }));

    const tests: RunLogInput[] = [];
    walk(this.suite, (test) => {
      if (!active.has(test.id) || test.status === "pending") return;
      tests.push({
        path: test.path,
        status: test.status,
        startedAtMs: test.startedAt,
        durationMs:
          test.startedAt !== undefined && test.endedAt !== undefined
            ? test.endedAt - test.startedAt
            : undefined,
        lines: mask(test.output.lines),
        artifacts: collectArtifacts(test),
        cached: test.cached === true ? true : undefined,
        reason: test.reason,
      });
    });
    // A fully condition-skipped run counts as success: nothing failed.
    const ok = status === "passed" || status === "skipped";
    this.lastRecord = this.history.saveRun(
      {
        name: this.doc.name,
        startedAtMs,
        durationMs,
        status: ok ? "passed" : runner.interrupted ? "aborted" : "failed",
        exitCode: runner.interrupted ? 130 : ok ? 0 : 1,
        cancelled: runner.interrupted,
        machine: detectMachine(),
        variants: this.runDefaults.variants,
        env: Object.fromEntries(
          Object.entries(runner.docEnv).map(([key, value]) => [key, maskSecrets(value, secrets)]),
        ),
        ports: runner.ports,
        selected: selectedIds
          .map((id) => this.byId.get(id)?.path)
          .filter((path): path is string => path !== undefined),
        suite: suiteStructure(this.suite),
      },
      tests,
      runner.services.map((service) => ({
        name: service.name,
        status: service.status,
        lines: mask(service.output.lines),
      })),
    );
  }
}

// The Testfile's shape as recorded in run.yaml: the whole tree, including
// tests this run filtered out, so the record explains itself. Matrix
// wrappers stay in the tree - they carry the definition their expanded
// instances share.
function suiteStructure(test: RunTest): RunRecordSuiteNode {
  const node: RunRecordSuiteNode = {
    name: test.name,
    path: test.path,
    kind: test.kind,
  };
  if (test.def.tags && test.def.tags.length > 0) node.tags = [...test.def.tags];
  if (Object.keys(test.matrix).length > 0) node.matrix = { ...test.matrix };
  // Matrix instances share their wrapper's definition; listing its services
  // once on the wrapper would repeat them on every instance.
  const services = Object.keys(test.def.services ?? {});
  if (services.length > 0 && !test.isMatrixWrapper) node.services = services;
  if (test.children.length > 0) node.children = test.children.map(suiteStructure);
  return node;
}

// Matches a test's artifact globs against its working directory. Runs after
// the test finished (also on failure), right before the run is recorded.
function collectArtifacts(test: RunTest): { absolute: string; relative: string }[] | undefined {
  if (!test.def.artifacts || test.resolvedCwd === undefined || test.status === "skipped") {
    return undefined;
  }
  const files: { absolute: string; relative: string }[] = [];
  for (const relative of globSync(test.def.artifacts, { cwd: test.resolvedCwd })) {
    const absolute = join(test.resolvedCwd, relative);
    try {
      if (statSync(absolute).isFile()) files.push({ absolute, relative });
    } catch {
      // ignore files that vanish between glob and stat
    }
  }
  return files;
}
