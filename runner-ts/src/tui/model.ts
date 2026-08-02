import { effectiveTags } from "../filter.js";
import type { RunHistory, RunRecord } from "../history.js";
import type { ReadyDef, ServiceDef, TestDef, TestfileDoc } from "../model.js";
import type { OutputLine } from "../output.js";
import { walk, type RunNode, type Status } from "../runtree.js";
import type { ServiceInstance } from "../services.js";
import { formatMs } from "../util.js";

// What the right (detail) pane shows: a titled block of log-style lines.
export interface PaneContent {
  title: string;
  note?: string;
  lines: OutputLine[];
}

// The nodes shown in the TUI tree, honoring collapsed groups and the search
// query. A non-empty query overrides collapsing: it shows every node whose
// path contains the query (case-insensitive) plus its ancestors for context.
export function visibleNodes(tree: RunNode, collapsed: Set<number>, query: string): RunNode[] {
  if (query !== "") {
    const q = query.toLowerCase();
    const keep = new Set<number>();
    walk(tree, (node) => {
      if (node.path.toLowerCase().includes(q)) {
        keep.add(node.id);
        for (let parent = node.parent; parent; parent = parent.parent) keep.add(parent.id);
      }
    });
    const out: RunNode[] = [];
    walk(tree, (node) => {
      if (keep.has(node.id)) out.push(node);
    });
    return out;
  }
  const out: RunNode[] = [];
  const visit = (node: RunNode): void => {
    out.push(node);
    if (!collapsed.has(node.id)) node.children.forEach(visit);
  };
  visit(tree);
  return out;
}

// Leaves to select for "re-run failed": failures of the current session, or -
// when nothing ran yet - failures of the most recent recorded run.
export function failedLeafIds(tree: RunNode, history: RunHistory): number[] {
  const failed: number[] = [];
  walk(tree, (node) => {
    if (node.children.length === 0 && (node.status === "failed" || node.status === "aborted")) {
      failed.push(node.id);
    }
  });
  if (failed.length > 0) return failed;
  walk(tree, (node) => {
    if (node.children.length !== 0) return;
    const latest = history.latestFor(node.path);
    if (latest && (latest.test.status === "failed" || latest.test.status === "aborted")) {
      failed.push(node.id);
    }
  });
  return failed;
}

// The test the cursor should follow while a run is in progress: the first
// running leaf, or - between leaves - the deepest running node.
export function runningFocus(tree: RunNode): RunNode | undefined {
  let leaf: RunNode | undefined;
  let deepest: RunNode | undefined;
  walk(tree, (node) => {
    if (node.status !== "running") return;
    if (node.children.length === 0 && !leaf) leaf = node;
    if (!deepest || node.depth > deepest.depth) deepest = node;
  });
  return leaf ?? deepest;
}

// A recorded run rendered as pane lines: metadata, then one line per test
// (failures on the stderr stream so they stand out).
export function describeRun(run: RunRecord): OutputLine[] {
  const lines: OutputLine[] = [
    { text: `started:   ${run.startedAt}`, stream: "system" },
    { text: `duration:  ${formatMs(run.durationMs)}`, stream: "system" },
    { text: `status:    ${run.status} (exit code ${run.exitCode})`, stream: "system" },
  ];
  if (run.cancelled) lines.push({ text: "cancelled: yes", stream: "system" });
  if (run.selected.length > 0) {
    lines.push({ text: `selected:  ${run.selected.join(", ")}`, stream: "system" });
  }
  const env = Object.entries(run.env)
    .map(([k, v]) => `${k}=${v}`)
    .join(" ");
  if (env) lines.push({ text: `env:       ${env}`, stream: "system" });
  const ports = Object.entries(run.ports)
    .map(([k, v]) => `${k}=${v}`)
    .join(" ");
  if (ports) lines.push({ text: `ports:     ${ports}`, stream: "system" });
  lines.push({ text: "", stream: "system" });
  for (const test of run.tests) {
    const duration = test.durationMs !== undefined ? ` (${formatMs(test.durationMs)})` : "";
    const artifacts = test.artifacts?.length ? `  [${test.artifacts.length} artifacts]` : "";
    lines.push({
      text: `${test.status.padEnd(8)} ${test.path}${duration}${artifacts}`,
      stream: test.status === "failed" || test.status === "aborted" ? "stderr" : "stdout",
    });
  }
  for (const service of run.services ?? []) {
    lines.push({
      text: `service  ${service.name}${service.status ? ` (${service.status})` : ""}${
        service.log ? "  [log]" : ""
      }`,
      stream: service.status === "failed" ? "stderr" : "system",
    });
  }
  return lines;
}

function testSummary(run: RunRecord): string {
  const counts = new Map<string, number>();
  for (const test of run.tests) counts.set(test.status, (counts.get(test.status) ?? 0) + 1);
  return [...counts.entries()].map(([status, n]) => `${n} ${status}`).join(", ");
}

// The runs view as a table: a header line plus one aligned row per run.
export function runsTable(runs: readonly RunRecord[]): { header: string; rows: string[] } {
  const header = `${pad("STARTED", 19)}  ${pad("STATUS", 7)}  ${pad("DURATION", 8)}  TESTS`;
  const rows = runs.map(
    (run) =>
      `${pad(run.startedAt.replace("T", " ").slice(0, 19), 19)}  ${pad(run.status, 7)}  ${pad(
        formatMs(run.durationMs),
        8
      )}  ${testSummary(run)}`
  );
  return { header, rows };
}

// The tests recorded across all runs, aggregated per test path - the basis
// of the results view. Built from the run records alone, so it also lists
// tests that no longer exist in the current Testfile. Ordered by the run
// they last appeared in (newest first), like the runs themselves.
export interface RecordedTest {
  path: string;
  occurrences: number;
  passes: number;
  fails: number;
  lastStatus: Status;
}

export function recordedTests(history: RunHistory): RecordedTest[] {
  const byPath = new Map<string, RecordedTest>();
  for (const run of history.runs) {
    for (const test of run.tests) {
      let entry = byPath.get(test.path);
      if (!entry) {
        // runs are newest first, so the first occurrence is the latest one
        byPath.set(
          test.path,
          (entry = { path: test.path, occurrences: 0, passes: 0, fails: 0, lastStatus: test.status })
        );
      }
      entry.occurrences++;
      if (test.status === "passed") entry.passes++;
      if (test.status === "failed" || test.status === "aborted") entry.fails++;
    }
  }
  return [...byPath.values()];
}

// Indices of log lines containing the query, case-insensitively.
export function findMatches(lines: readonly OutputLine[], query: string): number[] {
  if (query === "") return [];
  const q = query.toLowerCase();
  const out: number[] = [];
  lines.forEach((line, index) => {
    if (line.text.toLowerCase().includes(q)) out.push(index);
  });
  return out;
}

// The scroll value that centers the given line in a window of `height`.
export function scrollToLine(totalLines: number, height: number, line: number): number {
  return Math.max(0, totalLines - line - Math.ceil(height / 2));
}

// Slices the tail of a log for display: scroll = 0 follows the end, larger
// values scroll back. Returns the window plus how many lines are above it.
export function logWindow<T>(lines: T[], height: number, scroll: number): { window: T[]; above: number } {
  const maxScroll = Math.max(0, lines.length - height);
  const clamped = Math.min(scroll, maxScroll);
  const end = lines.length - clamped;
  const start = Math.max(0, end - height);
  return { window: lines.slice(start, end), above: start };
}

function pad(text: string, width: number): string {
  return text + " ".repeat(Math.max(0, width - text.length));
}

// One-line summary of a service's readiness check for the info views.
export function describeReady(ready?: ReadyDef): string | undefined {
  if (!ready) return undefined;
  if (ready.http !== undefined) {
    const http = typeof ready.http === "string" ? { url: ready.http } : ready.http;
    return `http ${http.method ?? "GET"} ${http.url}${http.status ? ` -> ${http.status}` : ""}`;
  }
  if (ready.tcp !== undefined) {
    const tcp =
      typeof ready.tcp === "object" ? ready.tcp : { port: ready.tcp };
    return `tcp ${tcp.host ?? "localhost"}:${tcp.port}`;
  }
  if (ready.log !== undefined) {
    const log = typeof ready.log === "string" ? { pattern: ready.log } : ready.log;
    return `log /${log.pattern}/${log.stream && log.stream !== "any" ? ` on ${log.stream}` : ""}`;
  }
  if (ready.exec !== undefined) {
    const exec = typeof ready.exec === "string" ? ready.exec : ready.exec.command;
    return `exec ${exec}`;
  }
  return undefined;
}

function serviceSummary(name: string, def: ServiceDef): string {
  const what = def.container
    ? `container ${def.container.image}`
    : def.command
      ? `command ${def.command}`
      : "script";
  return `${name} — ${what}${def.shared ? " (shared)" : ""}`;
}

function hookSummary(hook: { command?: string; script?: string }): string {
  return hook.command ?? hook.script?.trimEnd().split("\n")[0].concat(" ...") ?? "";
}

// The services a node depends on: its own, its ancestors', and the root ones.
export function requiredServices(
  node: RunNode,
  doc: TestfileDoc
): { name: string; def: ServiceDef }[] {
  const out: { name: string; def: ServiceDef }[] = [];
  const chain: RunNode[] = [];
  for (let n: RunNode | undefined = node; n; n = n.parent) chain.unshift(n);
  for (const [name, def] of Object.entries(doc.services ?? {})) out.push({ name, def });
  const seen = new Set<TestDef>();
  for (const n of chain) {
    if (seen.has(n.def)) continue; // matrix wrapper and instance share one def
    seen.add(n.def);
    for (const [name, def] of Object.entries(n.def.services ?? {})) out.push({ name, def });
  }
  return out;
}

// The info tab: everything the runner knows about a test before running it.
export function buildInfoLines(node: RunNode, doc: TestfileDoc, history: RunHistory): OutputLine[] {
  const def = node.def;
  const lines: OutputLine[] = [];
  const field = (label: string, value?: string): void => {
    if (value !== undefined && value !== "") {
      lines.push({ text: `${pad(`${label}:`, 11)}${value}`, stream: "system" });
    }
  };

  field("path", node.path);
  field("kind", node.isMatrixWrapper ? "matrix" : node.kind);
  field("descr", def.description);
  if (def.command !== undefined) field("command", def.command);
  field("shell", def.shell);
  if (def.script !== undefined) {
    lines.push({ text: "script:", stream: "system" });
    for (const line of def.script.trimEnd().split("\n")) {
      lines.push({ text: `  ${line}`, stream: "stdout" });
    }
  }
  field("workdir", def.workdir);
  field("timeout", def.timeout !== undefined ? String(def.timeout) : undefined);
  if (def.retry !== undefined) {
    const retry =
      typeof def.retry === "number"
        ? `${def.retry}`
        : `${def.retry.count}${def.retry.delay !== undefined ? `, delay ${def.retry.delay}` : ""}`;
    field("retry", retry);
  }
  if (def.continueOnError) field("on error", "continue");
  field("if", def.if);
  if (def.needs?.length) field("needs", def.needs.join(", "));
  const tags = [...effectiveTags(node)];
  if (tags.length > 0) field("tags", tags.join(", "));
  const matrix = Object.entries(node.matrix).map(([k, v]) => `${k}=${v}`);
  if (matrix.length > 0) field("matrix", matrix.join(" "));
  if (def.inputs?.length) field("inputs", def.inputs.join(", "));
  if (def.artifacts?.length) field("artifacts", def.artifacts.join(", "));

  // Env declared along the chain (root file first, the test itself last).
  const chain: RunNode[] = [];
  for (let n: RunNode | undefined = node; n; n = n.parent) chain.unshift(n);
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(doc.env ?? {})) env[key] = String(value);
  const seenDefs = new Set<TestDef>();
  const envFiles: string[] = [];
  const collectFiles = (spec?: string | string[]): void => {
    if (spec !== undefined) envFiles.push(...(Array.isArray(spec) ? spec : [spec]));
  };
  collectFiles(doc.envFile);
  for (const n of chain) {
    if (seenDefs.has(n.def)) continue;
    seenDefs.add(n.def);
    for (const [key, value] of Object.entries(n.def.env ?? {})) env[key] = String(value);
    collectFiles(n.def.envFile);
  }
  if (envFiles.length > 0) field("env files", envFiles.join(", "));
  const envEntries = Object.entries(env);
  if (envEntries.length > 0) {
    lines.push({ text: "env:", stream: "system" });
    for (const [key, value] of envEntries) {
      lines.push({ text: `  ${key}=${value}`, stream: "stdout" });
    }
  }

  const services = requiredServices(node, doc);
  if (services.length > 0) {
    lines.push({ text: "services:", stream: "system" });
    for (const { name, def: service } of services) {
      lines.push({ text: `  ${serviceSummary(name, service)}`, stream: "stdout" });
      const ready = describeReady(service.ready);
      if (ready) lines.push({ text: `    ready: ${ready}`, stream: "stdout" });
    }
  }
  if (def.setup) field("setup", hookSummary(def.setup));
  if (def.teardown) field("teardown", hookSummary(def.teardown));

  if (node.children.length === 0 || node.isMatrixWrapper) {
    const latest = history.latestFor(node.path);
    if (latest) {
      field(
        "last run",
        `${latest.test.status}${
          latest.test.durationMs !== undefined ? ` in ${formatMs(latest.test.durationMs)}` : ""
        } (${latest.run.startedAt.replace("T", " ").slice(0, 19)})`
      );
    }
  }
  return lines;
}

// The per-test history tab: one table row per recorded occurrence.
export function testHistoryLines(path: string, history: RunHistory): OutputLine[] {
  const rows: { run: RunRecord; test: RunRecord["tests"][number] }[] = [];
  for (const run of history.runs) {
    const test = run.tests.find((t) => t.path === path);
    if (test) rows.push({ run, test });
  }
  if (rows.length === 0) {
    return [{ text: "no recorded runs for this test", stream: "system" }];
  }
  const idWidth = Math.max(3, ...rows.map((r) => r.run.id.length));
  const lines: OutputLine[] = [
    {
      text: `${pad("RUN", idWidth)}  ${pad("STARTED", 19)}  ${pad("STATUS", 8)}  ${pad("DURATION", 8)}  NOTES`,
      stream: "system",
    },
  ];
  for (const { run, test } of rows) {
    const notes = [
      test.cached ? "[cached]" : "",
      test.artifacts?.length ? `[${test.artifacts.length} artifacts]` : "",
      test.log ? "[log]" : "",
    ]
      .filter(Boolean)
      .join(" ");
    lines.push({
      text: `${pad(run.id, idWidth)}  ${pad(run.startedAt.replace("T", " ").slice(0, 19), 19)}  ${pad(
        test.status,
        8
      )}  ${pad(test.durationMs !== undefined ? formatMs(test.durationMs) : "-", 8)}  ${notes}`.trimEnd(),
      stream: test.status === "failed" || test.status === "aborted" ? "stderr" : "stdout",
    });
  }
  return lines;
}

// Every service the Testfile defines, with the place it is declared at.
// Matrix wrappers and their instances share one def; only the wrapper counts.
export interface ServiceEntry {
  name: string;
  owner: string;
  def: ServiceDef;
}

export function collectServiceDefs(doc: TestfileDoc, tree: RunNode): ServiceEntry[] {
  const out: ServiceEntry[] = [];
  for (const [name, def] of Object.entries(doc.services ?? {})) {
    out.push({ name, owner: "Testfile", def });
  }
  const seen = new Set<TestDef>();
  walk(tree, (node) => {
    if (seen.has(node.def)) return;
    seen.add(node.def);
    for (const [name, def] of Object.entries(node.def.services ?? {})) {
      out.push({ name, owner: node.path, def });
    }
  });
  return out;
}

// One row of the services view: a live instance, or a defined service that
// has not been started (yet) in this session.
export interface ServiceRow {
  name: string;
  owner: string;
  instance?: ServiceInstance;
  def: ServiceDef;
}

export function serviceRows(entries: ServiceEntry[], instances: readonly ServiceInstance[]): ServiceRow[] {
  const rows: ServiceRow[] = instances.map((instance) => ({
    name: instance.name,
    owner: instance.owner,
    instance,
    def: instance.def,
  }));
  const liveNames = new Set(instances.map((instance) => instance.name));
  for (const entry of entries) {
    if (!liveNames.has(entry.name)) rows.push({ name: entry.name, owner: entry.owner, def: entry.def });
  }
  return rows;
}

// Definition details for a service that is not running.
export function describeServiceDef(row: ServiceRow): OutputLine[] {
  const def = row.def;
  const lines: OutputLine[] = [{ text: serviceSummary(row.name, def), stream: "system" }];
  if (def.description) lines.push({ text: def.description, stream: "system" });
  lines.push({ text: `declared in: ${row.owner}`, stream: "system" });
  if (def.script) {
    lines.push({ text: "script:", stream: "system" });
    for (const line of def.script.trimEnd().split("\n")) {
      lines.push({ text: `  ${line}`, stream: "stdout" });
    }
  }
  if (def.container) {
    if (def.container.ports?.length) {
      lines.push({ text: `ports: ${def.container.ports.join(", ")}`, stream: "system" });
    }
    if (def.container.engine && def.container.engine !== "auto") {
      lines.push({ text: `engine: ${def.container.engine}`, stream: "system" });
    }
  }
  for (const [key, value] of Object.entries(def.env ?? {})) {
    lines.push({ text: `env: ${key}=${value}`, stream: "system" });
  }
  const ready = describeReady(def.ready);
  if (ready) lines.push({ text: `ready: ${ready}`, stream: "system" });
  if (def.stop?.signal || def.stop?.command || def.stop?.timeout !== undefined) {
    const stop = def.stop.command ?? def.stop.signal ?? "SIGTERM";
    lines.push({
      text: `stop: ${stop}${def.stop.timeout !== undefined ? ` (timeout ${def.stop.timeout})` : ""}`,
      stream: "system",
    });
  }
  return lines;
}
