// Renders the whole TUI against a fake history and drives it by keys - a
// smoke test for the page stack, the tabs and the tables, not for pixels.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import React from "react";
import type { RunHistory, RunRecord } from "../runrecord.js";
import { App } from "./app.js";
import { renderForTest, type TestRender } from "./test-render.js";

const KEY = { enter: "\r", escape: "", tab: "\t", down: "[B", right: "[C" };

function record(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    id: "20260101-100000-aa01",
    startedAt: "2026-01-01T10:00:00.000Z",
    durationMs: 1200,
    status: "passed",
    exitCode: 0,
    cancelled: false,
    env: {},
    ports: {},
    selected: [],
    tests: [
      { path: "ci/unit", status: "passed", durationMs: 900 },
      { path: "ci/lint", status: "failed", durationMs: 100 },
    ],
    ...overrides,
  };
}

// The TUI only reads from the history; a plain object stands in fine.
function fakeHistory(runs: RunRecord[]): RunHistory {
  return {
    runs,
    reload() {},
    readRunLog: () => "=== run log ===",
    readLog: () => "test output here",
    readServiceLog: () => "service output here",
  } as unknown as RunHistory;
}

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 30));

async function withApp(
  view: "runs" | "tests",
  body: (ui: TestRender) => Promise<void>,
): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "tui-app-test-"));
  const history = fakeHistory([
    record(),
    record({ id: "20260101-110000-bb02", startedAt: "2026-01-01T11:00:00.000Z", status: "failed" }),
  ]);
  const ui = renderForTest(<App history={history} baseDir={dir} initialView={view} />);
  try {
    await tick();
    await body(ui);
  } finally {
    ui.unmount();
    rmSync(dir, { recursive: true, force: true });
  }
}

test("the index page lists runs and opens a run's detail page on enter", async () => {
  await withApp("runs", async ({ stdin, lastFrame }) => {
    const frame = lastFrame() ?? "";
    assert.match(frame, /Testfile › Runs/);
    assert.match(frame, /2026-01-01 10:00:00/);
    assert.match(frame, /2026-01-01 11:00:00/);
    assert.match(frame, /1 passed, 1 failed/);

    stdin.write(KEY.enter);
    await tick();
    const detail = lastFrame() ?? "";
    assert.match(detail, /Testfile › Runs › 20260101-/, "the run page breadcrumbs its id");
    assert.match(detail, /ci\/unit/, "the suite tree lists the tests");
    assert.match(detail, /Overview/, "the detail tabs render next to the tree");

    stdin.write(KEY.escape);
    await tick();
    assert.match(lastFrame() ?? "", /Testfile › Runs\b/, "escape pops back to the index");
  });
});

test("the tests tab filters executions and enter opens the test page", async () => {
  await withApp("tests", async ({ stdin, lastFrame }) => {
    const frame = lastFrame() ?? "";
    assert.match(frame, /Testfile › Tests/);
    assert.match(frame, /All tests/);
    assert.match(frame, /ci\/unit/);
    assert.match(frame, /RUN\s+TEST\s+STATUS/, "the right panel shows the executions table");

    // move to a concrete test, jump right, open its newest execution
    stdin.write(KEY.down);
    await tick();
    stdin.write(KEY.enter);
    await tick();
    stdin.write(KEY.enter);
    await tick();
    const page = lastFrame() ?? "";
    assert.match(page, /Testfile › Tests › ci\//, "the test page breadcrumbs the path");
    assert.match(page, /Overview.*Log/, "the test page shows the detail tabs");
  });
});

test("? opens the shortcut overlay and any key closes it", async () => {
  await withApp("runs", async ({ stdin, lastFrame }) => {
    stdin.write("?");
    await tick();
    assert.match(lastFrame() ?? "", /Shortcuts/);
    stdin.write(" ");
    await tick();
    assert.match(lastFrame() ?? "", /Testfile › Runs/);
  });
});
