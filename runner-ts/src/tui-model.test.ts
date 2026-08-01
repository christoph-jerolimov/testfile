import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { RunHistory } from "./history.js";
import type { TestfileDoc } from "./model.js";
import { buildRunTree, walk, type RunNode } from "./runtree.js";
import { Session } from "./session.js";
import {
  describeRun,
  failedLeafIds,
  logWindow,
  runListLabel,
  runningFocus,
  visibleNodes,
} from "./tui-model.js";

const doc: TestfileDoc = {
  version: 1,
  test: {
    name: "all",
    sequence: [
      { name: "lint", command: "true" },
      {
        name: "checks",
        parallel: [
          { name: "unit", command: "true" },
          { name: "e2e", command: "false", continueOnError: true },
        ],
      },
    ],
  },
};

function names(nodes: RunNode[]): string[] {
  return nodes.map((n) => n.name);
}

test("visibleNodes hides descendants of collapsed groups", () => {
  const tree = buildRunTree(doc);
  let checks: RunNode | undefined;
  walk(tree, (n) => {
    if (n.name === "checks") checks = n;
  });
  assert.deepEqual(names(visibleNodes(tree, new Set(), "")), ["all", "lint", "checks", "unit", "e2e"]);
  assert.deepEqual(names(visibleNodes(tree, new Set([checks!.id]), "")), ["all", "lint", "checks"]);
  assert.deepEqual(names(visibleNodes(tree, new Set([tree.id]), "")), ["all"]);
});

test("visibleNodes with a query shows matches plus ancestors and ignores collapsing", () => {
  const tree = buildRunTree(doc);
  assert.deepEqual(names(visibleNodes(tree, new Set([tree.id]), "e2e")), ["all", "checks", "e2e"]);
  assert.deepEqual(names(visibleNodes(tree, new Set(), "CHECKS")), ["all", "checks", "unit", "e2e"]);
  assert.deepEqual(names(visibleNodes(tree, new Set(), "nope")), []);
});

test("failedLeafIds prefers session results and falls back to history", async () => {
  const dir = mkdtempSync(join(tmpdir(), "testfile-tui-"));
  process.on("exit", () => rmSync(dir, { recursive: true, force: true }));
  const session = new Session(doc, dir);
  await session.runAll();
  // session state: e2e failed
  const fromSession = failedLeafIds(session.tree, session.history);
  assert.equal(fromSession.length, 1);
  assert.equal(session.byId.get(fromSession[0])!.name, "e2e");

  // a fresh session has no statuses -> falls back to the recorded run
  const fresh = new Session(doc, dir);
  const fromHistory = failedLeafIds(fresh.tree, fresh.history);
  assert.equal(fromHistory.length, 1);
  assert.equal(fresh.byId.get(fromHistory[0])!.name, "e2e");

  // no session state and no history -> nothing
  const empty = new Session(doc, mkdtempSync(join(tmpdir(), "testfile-tui2-")));
  assert.deepEqual(failedLeafIds(empty.tree, empty.history), []);
});

test("runningFocus prefers the first running leaf, then the deepest running node", () => {
  const tree = buildRunTree(doc);
  assert.equal(runningFocus(tree), undefined);

  const byName = new Map<string, RunNode>();
  walk(tree, (n) => byName.set(n.name, n));

  // only groups running (between leaves): deepest running node wins
  tree.status = "running";
  byName.get("checks")!.status = "running";
  assert.equal(runningFocus(tree)!.name, "checks");

  // a running leaf wins over running groups
  byName.get("e2e")!.status = "running";
  assert.equal(runningFocus(tree)!.name, "e2e");
});

test("describeRun and runListLabel render a recorded run", async () => {
  const dir = mkdtempSync(join(tmpdir(), "testfile-tui-hist-"));
  process.on("exit", () => rmSync(dir, { recursive: true, force: true }));
  const session = new Session(doc, dir);
  await session.runAll();
  const run = session.lastRecord!;

  const lines = describeRun(run);
  const text = lines.map((l) => l.text).join("\n");
  assert.match(text, /status: {4}passed \(exit code 0\)/);
  assert.match(text, /passed {3}all\/lint/);
  const failedLine = lines.find((l) => l.text.includes("all/checks/e2e"));
  assert.equal(failedLine?.stream, "stderr", "failed tests use the stderr stream");

  const label = runListLabel(run);
  assert.match(label, /passed/);
  assert.match(label, /\d+ failed/);
});

test("logWindow follows the tail and scrolls back with clamping", () => {
  const lines = Array.from({ length: 10 }, (_, i) => i);
  assert.deepEqual(logWindow(lines, 3, 0), { window: [7, 8, 9], above: 7 });
  assert.deepEqual(logWindow(lines, 3, 2), { window: [5, 6, 7], above: 5 });
  assert.deepEqual(logWindow(lines, 3, 99), { window: [0, 1, 2], above: 0 });
  assert.deepEqual(logWindow(lines, 20, 5), { window: lines, above: 0 });
});
