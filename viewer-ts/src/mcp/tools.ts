// What an agent can ask about a recorded history.
//
// Every tool here reads: the viewer does not run tests, and an assistant
// that wants to run one should call the runner (`testfile start
// --json-stream`) rather than have a read-only server grow a side door.
// What the tools buy is structure - no shell output to parse, no guessing
// at the layout of .testfile/ - and the same digests the CLI prints.
import {
  detectFlaky,
  diffRuns,
  explainOf,
  filterRuns,
  flakyWindows,
  reproOf,
  type RunHistory,
  type RunRecord,
  stripAnsi,
  verdictOf,
} from "@testfile/core";
import type { ToolDefinition } from "./protocol.js";

// A run as a list entry: enough to choose one, not the whole record.
function runSummary(run: RunRecord): Record<string, unknown> {
  const counts: Record<string, number> = {};
  for (const test of run.tests) counts[test.status] = (counts[test.status] ?? 0) + 1;
  return {
    id: run.id,
    startedAt: run.startedAt,
    status: run.status,
    durationMs: run.durationMs,
    ...(run.machine ? { machine: run.machine } : {}),
    ...(run.labels ? { labels: run.labels } : {}),
    ...(run.variants ? { variants: run.variants } : {}),
    ...(run.merged ? { mergedFrom: run.merged.runs.length } : {}),
    counts,
  };
}

function stringArg(args: Record<string, unknown>, name: string, fallback?: string): string {
  const value = args[name];
  if (typeof value === "string" && value !== "") return value;
  if (fallback !== undefined) return fallback;
  throw new Error(`${name} is required`);
}

function optionalString(args: Record<string, unknown>, name: string): string | undefined {
  const value = args[name];
  return typeof value === "string" && value !== "" ? value : undefined;
}

function stringList(args: Record<string, unknown>, name: string): string[] {
  const value = args[name];
  if (value === undefined) return [];
  if (Array.isArray(value)) return value.map(String);
  return [String(value)];
}

function numberArg(args: Record<string, unknown>, name: string, fallback: number): number {
  const value = args[name];
  if (value === undefined) return fallback;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n < 0) throw new Error(`${name} must be a non-negative number`);
  return n;
}

// Resolves a run: an id (or unique prefix), or the latest when none given.
function pick(history: RunHistory, id: string | undefined): RunRecord {
  if (id === undefined) {
    const latest = history.runs[0];
    if (!latest) throw new Error("no recorded runs yet");
    return latest;
  }
  const run = history.find(id);
  if (!run) throw new Error(`no recorded run matches "${id}"`);
  return run;
}

const RUN_ID = {
  type: "string",
  description: "run id, or a unique prefix of one; defaults to the latest run",
};

// `reload` is how the server sees runs recorded after it started: a long
// -lived agent session should not go stale because a run happened.
export function testfileTools(open: () => RunHistory): ToolDefinition[] {
  const history = (): RunHistory => {
    const loaded = open();
    loaded.reload();
    return loaded;
  };
  const readOnly = { readOnlyHint: true, idempotentHint: true };

  return [
    {
      name: "list_runs",
      description:
        "List recorded test runs, newest first, with their status and pass/fail counts. " +
        "Narrow with status, label or variant filters.",
      annotations: readOnly,
      inputSchema: {
        type: "object",
        properties: {
          status: {
            type: "array",
            items: { type: "string", enum: ["passed", "failed", "aborted"] },
            description: "keep only runs with any of these statuses",
          },
          label: {
            type: "array",
            items: { type: "string" },
            description: 'labels to match, e.g. "branch=main", or a bare key to mean "has it"',
          },
          variant: {
            type: "array",
            items: { type: "string" },
            description:
              'variants to match, e.g. "platform=linux"; a merged run matches by any leg',
          },
          limit: { type: "number", description: "how many runs to return (default 20)" },
        },
      },
      run: (args) => {
        const loaded = history();
        const filtered = filterRuns(loaded.runs, {
          statuses: stringList(args, "status"),
          labels: stringList(args, "label"),
          variants: stringList(args, "variant"),
        });
        const limit = numberArg(args, "limit", 20);
        return {
          total: loaded.runs.length,
          matched: filtered.length,
          runs: filtered.slice(0, limit).map(runSummary),
        };
      },
    },
    {
      name: "get_run",
      description:
        "The full record of one run: every test with its status, duration, reason, log path " +
        "and artifacts, the services it started, and the suite tree including tests it never ran.",
      annotations: readOnly,
      inputSchema: { type: "object", properties: { run: RUN_ID } },
      run: (args) => pick(history(), optionalString(args, "run")),
    },
    {
      name: "explain_run",
      description:
        "Digest one run: what failed, the end of each failing log, whether the history calls " +
        "the test flaky, and what changed against the run before. Start here when a run is red.",
      annotations: readOnly,
      inputSchema: {
        type: "object",
        properties: {
          run: RUN_ID,
          maxFailures: { type: "number", description: "how many failures to detail (default 10)" },
          logLines: { type: "number", description: "lines of log per failure (default 20)" },
        },
      },
      run: (args) => {
        const loaded = history();
        return explainOf(loaded, pick(loaded, optionalString(args, "run")), {
          maxFailures: numberArg(args, "maxFailures", 10),
          logLines: numberArg(args, "logLines", 20),
        });
      },
    },
    {
      name: "repro_test",
      description:
        "Everything needed to reproduce one recorded failure: the command that reruns exactly " +
        "that test, the environment it needs, the services it declares and the end of its log.",
      annotations: readOnly,
      inputSchema: {
        type: "object",
        properties: {
          test: { type: "string", description: "test path, e.g. ci/unit" },
          run: RUN_ID,
          variant: {
            type: "array",
            items: { type: "string" },
            description: 'which leg of a merged run, e.g. "platform=linux"',
          },
          logLines: { type: "number", description: "lines of log to include (default 40)" },
        },
        required: ["test"],
      },
      run: (args) => {
        const loaded = history();
        const variants: Record<string, string> = {};
        for (const pair of stringList(args, "variant")) {
          const at = pair.indexOf("=");
          if (at <= 0) throw new Error(`variant expects key=value, got "${pair}"`);
          variants[pair.slice(0, at)] = pair.slice(at + 1);
        }
        return reproOf(loaded, pick(loaded, optionalString(args, "run")), stringArg(args, "test"), {
          logLines: numberArg(args, "logLines", 40),
          ...(Object.keys(variants).length > 0 ? { variants } : {}),
        });
      },
    },
    {
      name: "get_test_log",
      description:
        "The log of one test in one run. Ask for the tail unless the whole thing is needed - " +
        "a failing log's last lines usually say why.",
      annotations: readOnly,
      inputSchema: {
        type: "object",
        properties: {
          test: { type: "string", description: "test path, e.g. ci/unit" },
          run: RUN_ID,
          tail: {
            type: "number",
            description: "only the last N lines; 0 (the default) means the whole log",
          },
        },
        required: ["test"],
      },
      run: (args) => {
        const loaded = history();
        const run = pick(loaded, optionalString(args, "run"));
        const path = stringArg(args, "test");
        const test = run.tests.find((candidate) => candidate.path === path);
        if (!test) throw new Error(`test "${path}" was not executed in run ${run.id}`);
        const log = loaded.readLog(run, test);
        if (log === undefined) throw new Error(`no log recorded for "${path}" in run ${run.id}`);
        const plain = stripAnsi(log);
        const tail = numberArg(args, "tail", 0);
        const lines = plain.replace(/\n$/, "").split("\n");
        return {
          run: run.id,
          test: path,
          status: test.status,
          lines: lines.length,
          text: tail > 0 ? lines.slice(-tail).join("\n") : plain,
        };
      },
    },
    {
      name: "diff_runs",
      description:
        "What changed between two runs: newly failing, fixed, still failing, added or removed " +
        "tests, and tests whose duration changed significantly.",
      annotations: readOnly,
      inputSchema: {
        type: "object",
        properties: {
          older: { type: "string", description: "the run to compare from (id or prefix)" },
          newer: { type: "string", description: "the run to compare to; defaults to the latest" },
        },
        required: ["older"],
      },
      run: (args) => {
        const loaded = history();
        const older = pick(loaded, stringArg(args, "older"));
        const newer = pick(loaded, optionalString(args, "newer"));
        return { older: older.id, newer: newer.id, ...diffRuns(older, newer) };
      },
    },
    {
      name: "list_tests",
      description:
        "Every test the history knows, with how often it passed and failed and what the flaky " +
        "rule says about it. Use it to tell a real failure from a known-flaky one.",
      annotations: readOnly,
      inputSchema: {
        type: "object",
        properties: {
          failingOnly: {
            type: "boolean",
            description: "only tests whose latest recorded result failed",
          },
        },
      },
      run: (args) => {
        const loaded = history();
        const windows = flakyWindows(loaded.runs);
        const tests = [...windows.entries()]
          .map(([path, recent]) => ({
            path,
            verdict: verdictOf(recent),
            recentResults: recent.length,
            recentFailures: recent.filter((status) => status === "failed").length,
            lastStatus: recent[0],
          }))
          .filter((test) => args.failingOnly !== true || test.lastStatus === "failed")
          .sort((a, b) => a.path.localeCompare(b.path));
        return { tests };
      },
    },
    {
      name: "list_flaky",
      description:
        "The tests the flaky rule flags as flaky or broken, worst first - what to fix or " +
        "quarantine rather than re-run.",
      annotations: readOnly,
      inputSchema: {
        type: "object",
        properties: {
          last: { type: "number", description: "consider only the N most recent runs" },
        },
      },
      run: (args) => {
        const loaded = history();
        const last = args.last === undefined ? undefined : numberArg(args, "last", 0);
        return { flaky: detectFlaky(loaded.runs, last) };
      },
    },
  ];
}
