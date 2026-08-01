import { EventEmitter } from "node:events";
import { Runner } from "./executor.js";
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

  constructor(
    readonly doc: TestfileDoc,
    readonly baseDir: string
  ) {
    super();
    validateSemantics(doc);
    this.tree = buildRunTree(doc);
    walk(this.tree, (node) => this.byId.set(node.id, node));
    this.history = new RunHistory(baseDir);
  }

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

    walk(this.tree, (node) => {
      if (active.has(node.id)) resetNode(node);
    });
    const runner = new Runner(this.doc, this.tree, this.baseDir, { active });
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
        lines: node.output.lines,
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
        env: runner.docEnv,
        ports: runner.ports,
        selected: selectedIds
          .map((id) => this.byId.get(id)?.path)
          .filter((path): path is string => path !== undefined),
      },
      tests,
      runner.services.map((service) => ({ name: service.name, lines: service.output.lines }))
    );
  }
}
