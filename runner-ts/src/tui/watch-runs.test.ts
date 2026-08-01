import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { watchRuns } from "./watch-runs.js";

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

test("watchRuns reports new run folders, debounced", async () => {
  const dir = mkdtempSync(join(tmpdir(), "testfile-watchruns-"));
  process.on("exit", () => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, ".testfile", "runs"), { recursive: true });

  let calls = 0;
  const stop = watchRuns(dir, () => calls++, 50);
  try {
    // establishing the watch fires one initial notification
    await sleep(150);
    const initial = calls;

    const runDir = join(dir, ".testfile", "runs", "20260101-000000-aaaa");
    mkdirSync(runDir, { recursive: true });
    writeFileSync(join(runDir, "run.yaml"), "id: 20260101-000000-aaaa\n");
    await sleep(250);
    assert.ok(calls > initial, "a new run folder triggers a change");
  } finally {
    stop();
  }
});
