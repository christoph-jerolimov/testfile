import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { RunHistory } from "../history.js";
import type { TestfileDoc } from "../model.js";
import { buildRunTree, walk, type RunNode } from "../runtree.js";
import { Session } from "../session.js";
import {
  buildInfoLines,
  collectServiceDefs,
  describeReady,
  describeRun,
  failedLeafIds,
  findMatches,
  logWindow,
  recordedTests,
  runningFocus,
  runsTable,
  scrollToLine,
  serviceRows,
  testHistoryLines,
  visibleNodes,
} from "./model.js";
import { isMouseSequence, parseWheelEvents } from "./mouse.js";

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

test("describeRun and runsTable render recorded runs", async () => {
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

  const table = runsTable(session.history.runs);
  assert.match(table.header, /STARTED\s+STATUS\s+DURATION\s+TESTS/);
  assert.equal(table.rows.length, 1);
  assert.match(table.rows[0], /passed/);
  assert.match(table.rows[0], /\d+ failed/);
});

test("recordedTests aggregates the tests of all recorded runs", async () => {
  const dir = mkdtempSync(join(tmpdir(), "testfile-tui-rec-"));
  process.on("exit", () => rmSync(dir, { recursive: true, force: true }));
  const session = new Session(doc, dir);
  await session.runAll();
  await session.runAll();

  // built from the run records alone: a fresh history is enough
  const fresh = new Session(doc, dir);
  const recorded = recordedTests(fresh.history);
  const e2e = recorded.find((t) => t.path === "all/checks/e2e");
  assert.ok(e2e);
  assert.equal(e2e.occurrences, 2);
  assert.equal(e2e.fails, 2);
  assert.equal(e2e.lastStatus, "failed");
  const lint = recorded.find((t) => t.path === "all/lint");
  assert.equal(lint?.passes, 2);
  assert.equal(lint?.lastStatus, "passed");
});

test("findMatches and scrollToLine locate lines in a log", () => {
  const lines = [
    { text: "starting", stream: "system" as const },
    { text: "Error: boom", stream: "stderr" as const },
    { text: "retrying", stream: "stdout" as const },
    { text: "error again", stream: "stdout" as const },
  ];
  assert.deepEqual(findMatches(lines, "error"), [1, 3]);
  assert.deepEqual(findMatches(lines, "nope"), []);
  assert.deepEqual(findMatches(lines, ""), []);
  // centering: 100 lines, window of 10, line 50 -> ~45 lines below it remain
  assert.equal(scrollToLine(100, 10, 50), 45);
  assert.equal(scrollToLine(100, 10, 99), 0, "matches near the tail clamp to 0");
});

test("logWindow follows the tail and scrolls back with clamping", () => {
  const lines = Array.from({ length: 10 }, (_, i) => i);
  assert.deepEqual(logWindow(lines, 3, 0), { window: [7, 8, 9], above: 7 });
  assert.deepEqual(logWindow(lines, 3, 2), { window: [5, 6, 7], above: 5 });
  assert.deepEqual(logWindow(lines, 3, 99), { window: [0, 1, 2], above: 0 });
  assert.deepEqual(logWindow(lines, 20, 5), { window: lines, above: 0 });
});

const richDoc: TestfileDoc = {
  version: 1,
  env: { BASE: "1" },
  services: { db: { container: { image: "postgres:16", ports: ["5432:5432"] }, ready: { tcp: 5432 } } },
  test: {
    name: "all",
    env: { LEVEL: "root" },
    sequence: [
      {
        name: "api",
        tags: ["fast"],
        env: { LEVEL: "api", ONLY: "here" },
        timeout: "30s",
        retry: { count: 2, delay: "1s" },
        inputs: ["src/**"],
        services: { mock: { command: "sleep 100", ready: { log: "up" } } },
        command: "npm test",
      },
      { name: "web", matrix: { browser: ["chrome", "firefox"] }, command: "true" },
    ],
  },
};

function nodeByName(tree: RunNode, name: string): RunNode {
  let found: RunNode | undefined;
  walk(tree, (n) => {
    if (n.name === name && !found) found = n;
  });
  assert.ok(found, `node ${name} not found`);
  return found;
}

test("buildInfoLines describes a test: command, env chain, services, matrix", async () => {
  const dir = mkdtempSync(join(tmpdir(), "testfile-info-"));
  process.on("exit", () => rmSync(dir, { recursive: true, force: true }));
  const session = new Session(richDoc, dir);

  const api = nodeByName(session.tree, "api");
  const text = buildInfoLines(api, richDoc, session.history)
    .map((l) => l.text)
    .join("\n");
  assert.match(text, /path: {6}all\/api/);
  assert.match(text, /command: {3}npm test/);
  assert.match(text, /timeout: {3}30s/);
  assert.match(text, /retry: {5}2, delay 1s/);
  assert.match(text, /tags: {6}fast/);
  assert.match(text, /inputs: {4}src\/\*\*/);
  // env merged along the chain: root doc, then "all", then "api"
  assert.match(text, /BASE=1/);
  assert.match(text, /LEVEL=api/);
  assert.match(text, /ONLY=here/);
  // root service and the test's own service, with readiness
  assert.match(text, /db — container postgres:16/);
  assert.match(text, /ready: tcp localhost:5432/);
  assert.match(text, /mock — command sleep 100/);
  assert.match(text, /ready: log \/up\//);

  // matrix instances report their combination
  const instance = nodeByName(session.tree, "web (browser=chrome)");
  const instanceText = buildInfoLines(instance, richDoc, session.history)
    .map((l) => l.text)
    .join("\n");
  assert.match(instanceText, /matrix: {4}browser=chrome/);
});

test("buildInfoLines includes the last recorded result", async () => {
  const dir = mkdtempSync(join(tmpdir(), "testfile-info-last-"));
  process.on("exit", () => rmSync(dir, { recursive: true, force: true }));
  const session = new Session(doc, dir);
  await session.runAll();

  const fresh = new Session(doc, dir);
  const text = buildInfoLines(nodeByName(fresh.tree, "e2e"), doc, fresh.history)
    .map((l) => l.text)
    .join("\n");
  assert.match(text, /last run: {2}failed/);
});

test("testHistoryLines renders a table of a test's recorded outcomes", async () => {
  const dir = mkdtempSync(join(tmpdir(), "testfile-tuihist-"));
  process.on("exit", () => rmSync(dir, { recursive: true, force: true }));
  const session = new Session(doc, dir);
  await session.runAll();
  await session.runAll();

  const lines = testHistoryLines("all/checks/e2e", session.history);
  assert.equal(lines[0].stream, "system");
  assert.match(lines[0].text, /RUN\s+STARTED\s+STATUS\s+DURATION/);
  const rows = lines.slice(1);
  assert.equal(rows.length, 2, "one row per recorded run");
  for (const row of rows) {
    assert.match(row.text, /failed/);
    assert.equal(row.stream, "stderr", "failed rows use the stderr stream");
    assert.match(row.text, /\[log\]/);
  }
  assert.deepEqual(testHistoryLines("nope", session.history), [
    { text: "no recorded runs for this test", stream: "system" },
  ]);
});

test("collectServiceDefs and serviceRows list defined and live services", () => {
  const tree = buildRunTree(richDoc);
  const defs = collectServiceDefs(richDoc, tree);
  assert.deepEqual(
    defs.map((d) => `${d.name}@${d.owner}`),
    ["db@Testfile", "mock@all/api"]
  );

  // without live instances every defined service is a startable row
  const idle = serviceRows(defs, []);
  assert.deepEqual(
    idle.map((r) => `${r.name}:${r.instance ? "live" : "startable"}`),
    ["db:startable", "mock:startable"]
  );

  // a live instance replaces the startable row of the same name
  const fakeDb = { name: "db", owner: "Testfile", def: defs[0].def } as never;
  const mixed = serviceRows(defs, [fakeDb]);
  assert.deepEqual(
    mixed.map((r) => `${r.name}:${r.instance ? "live" : "startable"}`),
    ["db:live", "mock:startable"]
  );
});

test("describeReady summarizes each readiness check", () => {
  assert.equal(describeReady(undefined), undefined);
  assert.equal(describeReady({ http: "http://localhost:8080/health" }), "http GET http://localhost:8080/health");
  assert.equal(
    describeReady({ http: { url: "/x", method: "POST", status: 204 } }),
    "http POST /x -> 204"
  );
  assert.equal(describeReady({ tcp: 5432 }), "tcp localhost:5432");
  assert.equal(describeReady({ tcp: { host: "db", port: "${{ ports.DB }}" } }), "tcp db:${{ ports.DB }}");
  assert.equal(describeReady({ log: "ready" }), "log /ready/");
  assert.equal(describeReady({ log: { pattern: "up", stream: "stderr" } }), "log /up/ on stderr");
  assert.equal(describeReady({ exec: "pg_isready" }), "exec pg_isready");
});

test("parseWheelEvents extracts wheel events from SGR mouse reports", () => {
  const esc = "\u001b";
  assert.deepEqual(parseWheelEvents(`${esc}[<64;10;5M`), [{ direction: "up", x: 10, y: 5 }]);
  assert.deepEqual(parseWheelEvents(`${esc}[<65;80;22M`), [{ direction: "down", x: 80, y: 22 }]);
  // several events in one chunk
  assert.equal(parseWheelEvents(`${esc}[<64;1;1M${esc}[<64;1;1M${esc}[<65;9;9M`).length, 3);
  // clicks (0/1/2), releases (m) and plain keys are ignored
  assert.deepEqual(parseWheelEvents(`${esc}[<0;10;5M${esc}[<0;10;5m`), []);
  assert.deepEqual(parseWheelEvents("jk"), []);
  assert.ok(isMouseSequence("[<65;80;22M"));
  assert.ok(!isMouseSequence("j"));
});
