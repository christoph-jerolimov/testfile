import assert from "node:assert/strict";
import { test } from "node:test";
import { formatMs, parseDurationMs } from "./util.js";

test("parseDurationMs accepts integers as seconds", () => {
  assert.equal(parseDurationMs(30, 0), 30_000);
  assert.equal(parseDurationMs(0, 99), 0);
});

test("parseDurationMs accepts unit strings", () => {
  assert.equal(parseDurationMs("500ms", 0), 500);
  assert.equal(parseDurationMs("30s", 0), 30_000);
  assert.equal(parseDurationMs("5m", 0), 300_000);
  assert.equal(parseDurationMs("1h", 0), 3_600_000);
});

test("parseDurationMs falls back when undefined and rejects garbage", () => {
  assert.equal(parseDurationMs(undefined, 1234), 1234);
  assert.throws(() => parseDurationMs("5 minutes", 0), /invalid duration/);
});

test("formatMs", () => {
  assert.equal(formatMs(500), "500ms");
  assert.equal(formatMs(1500), "1.5s");
  assert.equal(formatMs(90_000), "1m30s");
});
