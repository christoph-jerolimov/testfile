import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { test } from "node:test";
import { stringify } from "yaml";
import {
  handleLine,
  METHOD_NOT_FOUND,
  PARSE_ERROR,
  PROTOCOL_VERSION,
  serveStdio,
  type JsonRpcResponse,
  type ToolDefinition,
} from "./protocol.js";
import { testfileTools } from "./tools.js";
import { RunHistory, type RunRecord, type RunRecordTest } from "@testfile/core";

const server = { name: "testfile", version: "0.1.0", instructions: "read recorded runs" };

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "testfile-mcp-"));
  process.on("exit", () => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function run(id: string, startedAt: string, tests: RunRecordTest[]): RunRecord {
  return {
    id,
    startedAt,
    durationMs: 1000,
    status: tests.some((t) => t.status === "failed") ? "failed" : "passed",
    exitCode: 0,
    cancelled: false,
    labels: { branch: "main" },
    env: {},
    ports: {},
    selected: ["ci"],
    tests,
  };
}

function historyWith(runs: RunRecord[], logs: Record<string, Record<string, string>> = {}) {
  const dir = tempDir();
  for (const record of runs) {
    const runDir = join(dir, ".testfile", "runs", record.id);
    mkdirSync(runDir, { recursive: true });
    for (const [path, text] of Object.entries(logs[record.id] ?? {})) {
      mkdirSync(join(runDir, path, ".."), { recursive: true });
      writeFileSync(join(runDir, path), text);
    }
    writeFileSync(join(runDir, "run.yaml"), stringify(record));
  }
  return new RunHistory(dir);
}

// Calls a tool the way a client would, and parses what it answered.
function call(tools: ToolDefinition[], name: string, args: Record<string, unknown> = {}): unknown {
  const response = handleLine(
    JSON.stringify({
      jsonrpc: "2.0",
      id: 7,
      method: "tools/call",
      params: { name, arguments: args },
    }),
    server,
    tools,
  ) as JsonRpcResponse;
  const result = response.result as { content: { text: string }[]; isError?: boolean };
  assert.equal(result.isError, undefined, `tool ${name} failed: ${result.content[0]?.text}`);
  return JSON.parse(result.content[0].text);
}

function callError(tools: ToolDefinition[], name: string, args: Record<string, unknown>): string {
  const response = handleLine(
    JSON.stringify({
      jsonrpc: "2.0",
      id: 8,
      method: "tools/call",
      params: { name, arguments: args },
    }),
    server,
    tools,
  ) as JsonRpcResponse;
  const result = response.result as { content: { text: string }[]; isError?: boolean };
  assert.equal(result.isError, true, `tool ${name} was expected to fail`);
  return result.content[0].text;
}

const noTools: ToolDefinition[] = [];

test("initialize announces the protocol, the server and its tools capability", () => {
  const response = handleLine(
    JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
    server,
    noTools,
  ) as JsonRpcResponse;
  const result = response.result as Record<string, unknown>;
  assert.equal(response.id, 1);
  assert.equal(result.protocolVersion, PROTOCOL_VERSION);
  assert.deepEqual(result.capabilities, { tools: {} });
  assert.deepEqual(result.serverInfo, { name: "testfile", version: "0.1.0" });
  assert.equal(result.instructions, "read recorded runs");
});

test("a notification is never answered, an unknown method always is", () => {
  assert.equal(
    handleLine(
      JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
      server,
      noTools,
    ),
    undefined,
  );
  const unknown = handleLine(
    JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/nope" }),
    server,
    noTools,
  ) as JsonRpcResponse;
  assert.equal(unknown.error?.code, METHOD_NOT_FOUND);
  assert.match(unknown.error!.message, /unknown method/);
});

test("a broken line is a parse error, not a crash", () => {
  const response = handleLine("{not json", server, noTools) as JsonRpcResponse;
  assert.equal(response.error?.code, PARSE_ERROR);
  assert.equal(handleLine(JSON.stringify([1, 2]), server, noTools)?.error?.code, -32600);
  assert.equal(
    handleLine(JSON.stringify({ jsonrpc: "2.0", id: 3 }), server, noTools)?.error?.code,
    -32600,
  );
});

test("tools/list describes every tool, and all of them are read-only", () => {
  const tools = testfileTools(() => historyWith([]));
  const response = handleLine(
    JSON.stringify({ jsonrpc: "2.0", id: 4, method: "tools/list" }),
    server,
    tools,
  ) as JsonRpcResponse;
  const listed = (response.result as { tools: Record<string, unknown>[] }).tools;
  assert.deepEqual(listed.map((tool) => tool.name).sort(), [
    "diff_runs",
    "explain_run",
    "get_run",
    "get_test_log",
    "list_flaky",
    "list_runs",
    "list_tests",
    "repro_test",
  ]);
  for (const tool of listed) {
    assert.ok(String(tool.description).length > 20, `${tool.name} needs a usable description`);
    assert.equal((tool.inputSchema as { type: string }).type, "object");
    assert.deepEqual(tool.annotations, { readOnlyHint: true, idempotentHint: true });
  }
});

test("a tool that cannot do its job answers with an error result, not a protocol error", () => {
  const tools = testfileTools(() => historyWith([]));
  const message = callError(tools, "explain_run", {});
  assert.match(message, /no recorded runs yet/);

  // an unknown tool is a protocol error, because the client asked wrongly
  const response = handleLine(
    JSON.stringify({ jsonrpc: "2.0", id: 9, method: "tools/call", params: { name: "nope" } }),
    server,
    tools,
  ) as JsonRpcResponse;
  assert.match(response.error!.message, /no such tool/);
});

test("list_runs summarizes and narrows the history", () => {
  const tools = testfileTools(() =>
    historyWith([
      run("20260802-120000-bbbb", "2026-08-02T12:00:00.000Z", [
        { path: "ci/unit", status: "failed" },
        { path: "ci/build", status: "passed" },
      ]),
      run("20260801-120000-aaaa", "2026-08-01T12:00:00.000Z", [
        { path: "ci/unit", status: "passed" },
      ]),
    ]),
  );
  const all = call(tools, "list_runs") as { total: number; matched: number; runs: any[] };
  assert.equal(all.total, 2);
  assert.equal(all.runs[0].id, "20260802-120000-bbbb", "newest first");
  assert.deepEqual(all.runs[0].counts, { failed: 1, passed: 1 });

  const failed = call(tools, "list_runs", { status: ["failed"] }) as { matched: number };
  assert.equal(failed.matched, 1);
  const byLabel = call(tools, "list_runs", { label: ["branch=main"] }) as { matched: number };
  assert.equal(byLabel.matched, 2);
  const limited = call(tools, "list_runs", { limit: 1 }) as { runs: unknown[] };
  assert.equal(limited.runs.length, 1);
});

test("explain_run, repro_test and get_test_log work off the same recorded run", () => {
  const tools = testfileTools(() =>
    historyWith(
      [
        run("20260802-120000-bbbb", "2026-08-02T12:00:00.000Z", [
          { path: "ci/unit", status: "failed", log: "tests/unit.log" },
        ]),
      ],
      {
        "20260802-120000-bbbb": {
          "tests/unit.log": ["setting up", "[31mboom[0m: expected 4"].join("\n"),
        },
      },
    ),
  );

  const explain = call(tools, "explain_run") as { failures: { path: string; logTail: string }[] };
  assert.equal(explain.failures[0].path, "ci/unit");
  assert.match(explain.failures[0].logTail, /boom: expected 4/);

  const repro = call(tools, "repro_test", { test: "ci/unit" }) as { command: string };
  assert.equal(repro.command, "testfile start -n ci/unit");

  const log = call(tools, "get_test_log", { test: "ci/unit", tail: 1 }) as {
    lines: number;
    text: string;
  };
  assert.equal(log.lines, 2);
  assert.equal(log.text, "boom: expected 4", "the tail, without the colour");

  assert.match(callError(tools, "get_test_log", { test: "ci/nope" }), /was not executed/);
});

test("list_tests and list_flaky judge tests by the same rule as the CLI", () => {
  const runs = Array.from({ length: 12 }, (_, i) =>
    run(
      `202608${String(12 - i).padStart(2, "0")}-120000-r${i}`,
      `2026-08-${String(12 - i).padStart(2, "0")}T12:00:00.000Z`,
      [
        { path: "ci/e2e", status: i % 2 === 0 ? "failed" : "passed" },
        { path: "ci/build", status: "passed" },
      ],
    ),
  );
  const tools = testfileTools(() => historyWith(runs));

  const tests = call(tools, "list_tests") as { tests: { path: string; verdict: string }[] };
  assert.deepEqual(
    tests.tests.map((t) => [t.path, t.verdict]),
    [
      ["ci/build", "healthy"],
      ["ci/e2e", "flaky"],
    ],
  );
  const failing = call(tools, "list_tests", { failingOnly: true }) as { tests: { path: string }[] };
  assert.deepEqual(
    failing.tests.map((t) => t.path),
    ["ci/e2e"],
  );

  const flaky = call(tools, "list_flaky") as { flaky: { path: string; verdict: string }[] };
  assert.deepEqual(
    flaky.flaky.map((f) => f.path),
    ["ci/e2e"],
  );
});

test("diff_runs compares two recorded runs", () => {
  const tools = testfileTools(() =>
    historyWith([
      run("20260802-120000-bbbb", "2026-08-02T12:00:00.000Z", [
        { path: "ci/unit", status: "failed" },
      ]),
      run("20260801-120000-aaaa", "2026-08-01T12:00:00.000Z", [
        { path: "ci/unit", status: "passed" },
      ]),
    ]),
  );
  const diff = call(tools, "diff_runs", { older: "20260801" }) as {
    older: string;
    newer: string;
    newlyFailed: string[];
  };
  assert.equal(diff.older, "20260801-120000-aaaa");
  assert.equal(diff.newer, "20260802-120000-bbbb", "the latest run, by default");
  assert.deepEqual(diff.newlyFailed, ["ci/unit"]);
});

test("a run recorded while a client is connected is seen without a restart", () => {
  const dir = tempDir();
  const write = (record: RunRecord): void => {
    const runDir = join(dir, ".testfile", "runs", record.id);
    mkdirSync(runDir, { recursive: true });
    writeFileSync(join(runDir, "run.yaml"), stringify(record));
  };
  write(
    run("20260801-120000-aaaa", "2026-08-01T12:00:00.000Z", [{ path: "ci", status: "passed" }]),
  );
  const history = new RunHistory(dir);
  const tools = testfileTools(() => history);
  assert.equal((call(tools, "list_runs") as { total: number }).total, 1);

  write(
    run("20260802-120000-bbbb", "2026-08-02T12:00:00.000Z", [{ path: "ci", status: "failed" }]),
  );
  assert.equal(
    (call(tools, "list_runs") as { total: number }).total,
    2,
    "the new run is picked up",
  );
});

test("the stdio transport answers line by line and ignores blank lines", async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  const written: string[] = [];
  output.on("data", (chunk: Buffer) => written.push(chunk.toString()));
  serveStdio(
    input,
    output,
    server,
    testfileTools(() => historyWith([])),
  );

  input.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" })}\n`);
  input.write("\n");
  // a request split across two chunks is still one request
  input.write(`${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "ping" }).slice(0, 10)}`);
  input.write(`${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "ping" }).slice(10)}\n`);
  input.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
  await new Promise((resolve) => setImmediate(resolve));

  const lines = written.join("").trim().split("\n");
  assert.equal(lines.length, 2, "one answer per request, none for the notification");
  assert.equal(JSON.parse(lines[0]).id, 1);
  assert.deepEqual(JSON.parse(lines[1]), { jsonrpc: "2.0", id: 2, result: {} });
});
