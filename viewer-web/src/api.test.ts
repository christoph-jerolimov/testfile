import assert from "node:assert/strict";
import { test } from "node:test";
import { runLogUrl, serviceLogUrl, testLogUrl } from "./api.js";

test("log URLs point at the serve API", () => {
  assert.equal(runLogUrl("20260101-120000-fx01"), "/api/runs/20260101-120000-fx01/log");
});

test("test and service names are query-encoded", () => {
  assert.equal(testLogUrl("r1", "ci/unit tests"), "/api/runs/r1/log?test=ci%2Funit%20tests");
  assert.equal(serviceLogUrl("r1", "db&cache"), "/api/runs/r1/log?service=db%26cache");
});
