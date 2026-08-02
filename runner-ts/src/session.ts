import { EventEmitter } from "node:events";
import { globSync, statSync } from "node:fs";
import { join } from "node:path";
import { ResultCache } from "./cache.js";
import { maskSecrets } from "./envfile.js";
import { Runner } from "./executor.js";
import type { OutputLine } from "./output.js";
import { RunHistory, type RunLogInput, type RunRecord } from "./history.js";
import { validateSemantics } from "./loader.js";
import type { TestfileDoc } from "./model.js";
import { buildRunTree, resetNode, walk, type RunNode, type Status } from "./runtree.js";

// Owns the test tree, run history and the (re)creation of Runners, so the
// TUI and the CLI can run the tree - or a selected part of it - repeatedly.
// Events: "update" (state changed), "runner" (a new Runner was created).
export class Session extends EventEmitter {
  readonly tree: RunNode;
  readonly history: RunHistory;
  readonly byId = new Map<number, RunNode>();
  runner?: Runner;
  running = false;
  lastRecord?: RunRecord;
  // The selection of the most recent run, e.g. for watch-mode re-runs.
  lastSelection?: number[];

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
    } = {}
  ) {
    super();
    validateSemantics(doc);
    this.tree = buildRunTree(doc);
    walk(this.tree, (node) => this.byId.set(node.id, node));
    this.history = new RunHistory(baseDir);
    this.cache = new ResultCache(baseDir, !(runDefaults.noCache ?? false));
  }

  readonly cache: ResultCache;

  // A selected node runs with its whole subtree; ancestors run as scaffolding
  // (their sequence/parallel semantics and services still apply).
  activeSetFor(selection: Iterable<number>): Set<number> {
    const active = new Set<number>();
    for (const id of selection) {
      const node = this.byId.get(id);
      if (!node) continue;
      walk(node, (n) => active.add(n.id));
      for (let parent = node.parent; parent; parent = parent.parent) active.add(parent.id);
    }
    return active;
  }

  async runSelected(
    selection: Iterable<number>,
    options: { exclude?: (node: RunNode) => boolean } = {}
  ): Promise<Status | undefined> {
    if (this.running) return undefined;
    const selectedIds = [...selection];
    const active = this.activeSetFor(selectedIds);
    if (options.exclude) {
      for (const id of [...active]) {
        const node = this.byId.get(id);
        if (node && options.exclude(node)) active.delete(id);
      }
    }
    if (active.size === 0) return undefined;
    this.lastSelection = selectedIds;

    walk(this.tree, (node) => {
      if (active.has(node.id)) resetNode(node);
    });
    const runner = new Runner(this.doc, this.tree, this.baseDir, {
      active,
      failFast: this.runDefaults.failFast,
      maxParallel: this.runDefaults.maxParallel,
      cache: this.cache,
      forwardEnv: this.runDefaults.forwardEnv,
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
    return this.runSelected([this.tree.id]);
  }

  private persist(
    runner: Runner,
    active: Set<number>,
    selectedIds: number[],
    status: Status,
    startedAtMs: number,
    durationMs: number
  ): void {
    // Values loaded from env files never reach the recorded logs or record.
    const secrets = [...runner.secrets].filter((secret) => secret.length >= 4);
    const mask = (lines: OutputLine[]): OutputLine[] =>
      secrets.length === 0
        ? lines
        : lines.map((line) => ({ ...line, text: maskSecrets(line.text, secrets) }));

    const tests: RunLogInput[] = [];
    walk(this.tree, (node) => {
      if (!active.has(node.id) || node.status === "pending") return;
      tests.push({
        path: node.path,
        status: node.status,
        durationMs:
          node.startedAt !== undefined && node.endedAt !== undefined
            ? node.endedAt - node.startedAt
            : undefined,
        lines: mask(node.output.lines),
        artifacts: collectArtifacts(node),
        cached: node.cached === true ? true : undefined,
      });
    });
    // A fully condition-skipped run counts as success: nothing failed.
    const ok = status === "passed" || status === "skipped";
    this.lastRecord = this.history.saveRun(
      {
        startedAtMs,
        durationMs,
        status: ok ? "passed" : runner.interrupted ? "aborted" : "failed",
        exitCode: runner.interrupted ? 130 : ok ? 0 : 1,
        cancelled: runner.interrupted,
        env: Object.fromEntries(
          Object.entries(runner.docEnv).map(([key, value]) => [key, maskSecrets(value, secrets)])
        ),
        ports: runner.ports,
        selected: selectedIds
          .map((id) => this.byId.get(id)?.path)
          .filter((path): path is string => path !== undefined),
      },
      tests,
      runner.services.map((service) => ({ name: service.name, lines: mask(service.output.lines) }))
    );
  }
}

// Matches a test's artifact globs against its working directory. Runs after
// the test finished (also on failure), right before the run is recorded.
function collectArtifacts(node: RunNode): { absolute: string; relative: string }[] | undefined {
  if (!node.def.artifacts || node.resolvedCwd === undefined || node.status === "skipped") {
    return undefined;
  }
  const files: { absolute: string; relative: string }[] = [];
  for (const relative of globSync(node.def.artifacts, { cwd: node.resolvedCwd })) {
    const absolute = join(node.resolvedCwd, relative);
    try {
      if (statSync(absolute).isFile()) files.push({ absolute, relative });
    } catch {
      // ignore files that vanish between glob and stat
    }
  }
  return files;
}
