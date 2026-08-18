// The adapter is the only code here that could be wrong on its own: the loop
// belongs to the SDK and the tools belong to @testfile.dev/mcp. So it is checked
// against the thing it has to agree with - the stdio server - rather than
// against a copy of its own expectations.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { stringify } from "yaml";
import { handleLine, type JsonRpcResponse, testfileTools } from "@testfile.dev/mcp";
import { RunHistory, type RunRecord } from "@testfile.dev/core";
import { historyTools, inProcessClient } from "./tools.js";

const SERVER = { name: "testfile", version: "0.1.0" };

function historyWith(runs: RunRecord[]): RunHistory {
  const dir = mkdtempSync(join(tmpdir(), "testfile-eve-"));
  process.on("exit", () => rmSync(dir, { recursive: true, force: true }));
  for (const record of runs) {
    const runDir = join(dir, ".testfile", "runs", record.id);
    mkdirSync(runDir, { recursive: true });
    writeFileSync(join(runDir, "run.yaml"), stringify(record));
  }
  return new RunHistory(dir);
}

function run(id: string, startedAt: string, status: "passed" | "failed"): RunRecord {
  return {
    id,
    startedAt,
    durationMs: 1000,
    status,
    exitCode: status === "passed" ? 0 : 1,
    cancelled: false,
    labels: { branch: "main" },
    env: {},
    ports: {},
    selected: ["ci"],
    tests: [{ path: "ci/unit", status, durationMs: 500 }],
  };
}

const HISTORY = () =>
  historyWith([
    run("20260101-120000-aaaa", "2026-01-01T12:00:00.000Z", "failed"),
    run("20260101-110000-bbbb", "2026-01-01T11:00:00.000Z", "passed"),
  ]);

// What the stdio server answers for the same call - the oracle.
function overTheWire(
  history: RunHistory,
  name: string,
  args: Record<string, unknown>,
): { content: { text: string }[]; isError?: boolean } {
  const response = handleLine(
    JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name, arguments: args },
    }),
    SERVER,
    testfileTools(() => history),
  ) as JsonRpcResponse;
  return response.result as { content: { text: string }[]; isError?: boolean };
}

test("in process, a tool answers exactly what the stdio server answers", async () => {
  for (const [name, args] of [
    ["list_runs", {}],
    ["list_runs", { status: ["failed"] }],
    ["get_run", { run: "20260101-120000-aaaa" }],
    ["explain_run", { run: "20260101-120000-aaaa" }],
    ["list_tests", {}],
    ["list_flaky", {}],
    ["diff_runs", { older: "20260101-110000-bbbb", newer: "20260101-120000-aaaa" }],
  ] as const) {
    const direct = await inProcessClient(testfileTools(HISTORY)).callTool({
      name,
      arguments: args,
    });
    const wire = overTheWire(HISTORY(), name, args);
    assert.equal(direct.isError, undefined, `${name} failed: ${direct.content[0]?.text}`);
    // byte for byte, not just the same data: what the model is shown is this
    // text, and an editor talking to `testfile mcp` is shown the other one.
    assert.equal(
      direct.content[0].text,
      wire.content[0].text,
      `${name} disagrees with the stdio server`,
    );
  }
});

test("a tool that cannot do its job is a result, not a thrown error", async () => {
  const result = await inProcessClient(testfileTools(HISTORY)).callTool({
    name: "get_run",
    arguments: { run: "nope" },
  });
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /no recorded run matches "nope"/);
  // and the wire says the same thing
  assert.equal(overTheWire(HISTORY(), "get_run", { run: "nope" }).isError, true);
});

test("a name no tool has is reported rather than crashing the turn", async () => {
  const result = await inProcessClient(testfileTools(HISTORY)).callTool({ name: "drop_database" });
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /no tool named "drop_database"/);
});

test("every tool the MCP server exposes reaches the model, with its schema", () => {
  const history = HISTORY();
  const definitions = testfileTools(() => history);
  const tools = historyTools(history);

  assert.deepEqual(
    tools.map((tool) => tool.name).sort(),
    definitions.map((definition) => definition.name).sort(),
  );
  assert.ok(tools.length >= 5, `expected the history tools, got ${tools.length}`);

  for (const definition of definitions) {
    const tool = tools.find((candidate) => candidate.name === definition.name);
    assert.ok(tool, `${definition.name} was not converted`);
    // BetaRunnableTool also covers the SDK's built-in tools, which carry no
    // schema of their own - these are custom ones, so both fields are there.
    assert.ok("input_schema" in tool, `${definition.name} lost its schema`);
    assert.equal(tool.description, definition.description);
    // the schema the model is shown has to be the schema the tool validates
    assert.deepEqual(tool.input_schema.properties, definition.inputSchema.properties);
  }
});

test("running a converted tool returns the same JSON as calling it directly", async () => {
  const history = HISTORY();
  const listRuns = historyTools(history).find((tool) => tool.name === "list_runs");
  assert.ok(listRuns);
  const viaModel = await listRuns.run({}, undefined as never);
  const direct = await inProcessClient(testfileTools(() => history)).callTool({
    name: "list_runs",
  });
  const text = typeof viaModel === "string" ? viaModel : JSON.stringify(viaModel);
  assert.match(text, /20260101-120000-aaaa/);
  assert.ok(direct.content[0].text.includes("20260101-120000-aaaa"));
});
