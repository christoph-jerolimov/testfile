import assert from "node:assert/strict";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { isIgnoredPath, WatchScheduler } from "./watch.js";

test("isIgnoredPath ignores history, git and node_modules paths", () => {
  assert.equal(isIgnoredPath(".testfile/runs/20260801-1/run.yaml"), true);
  assert.equal(isIgnoredPath("node_modules/pkg/index.js"), true);
  assert.equal(isIgnoredPath(".git/HEAD"), true);
  assert.equal(isIgnoredPath("src/deep/node_modules/x"), true);
  assert.equal(isIgnoredPath("src/app.ts"), false);
  assert.equal(isIgnoredPath("Testfile"), false);
  assert.equal(isIgnoredPath(".env.test"), false);
});

test("WatchScheduler debounces bursts into one trigger", async () => {
  let triggers = 0;
  const scheduler = new WatchScheduler({
    debounceMs: 20,
    isRunning: () => false,
    trigger: () => triggers++,
  });
  scheduler.notify();
  scheduler.notify();
  scheduler.notify();
  await delay(60);
  assert.equal(triggers, 1);
  scheduler.notify();
  await delay(60);
  assert.equal(triggers, 2);
  scheduler.close();
});

test("WatchScheduler defers triggers while a run is in progress", async () => {
  let running = true;
  let triggers = 0;
  const scheduler = new WatchScheduler({
    debounceMs: 10,
    isRunning: () => running,
    trigger: () => triggers++,
  });
  scheduler.notify();
  await delay(40);
  assert.equal(triggers, 0, "must not trigger while running");
  running = false;
  scheduler.runFinished();
  assert.equal(triggers, 1, "deferred trigger fires when the run finished");
  scheduler.runFinished();
  assert.equal(triggers, 1, "no duplicate trigger");
  scheduler.close();
});
