import assert from "node:assert/strict";
import { test } from "node:test";
import { fileName, fileUrl, runLogUrl, serviceLogUrl, testLogUrl } from "./api.js";

test("log URLs point at the serve API", () => {
  assert.equal(runLogUrl("20260101-120000-fx01"), "/api/runs/20260101-120000-fx01/log");
});

test("test and service names are query-encoded", () => {
  assert.equal(testLogUrl("r1", "ci/unit tests"), "/api/runs/r1/log?test=ci%2Funit%20tests");
  assert.equal(serviceLogUrl("r1", "db&cache"), "/api/runs/r1/log?service=db%26cache");
});

test("a file URL keeps the recorded path's slashes and escapes the rest", () => {
  assert.equal(fileUrl("r1", "junit.xml"), "/api/runs/r1/artifacts/junit.xml");
  assert.equal(
    fileUrl("r1", "artifacts/ci-unit/report.txt"),
    "/api/runs/r1/artifacts/artifacts/ci-unit/report.txt",
  );
  // a name with a space, a hash or a question mark is still one segment
  assert.equal(
    fileUrl("r1", "artifacts/a b/c#d?e.txt"),
    "/api/runs/r1/artifacts/artifacts/a%20b/c%23d%3Fe.txt",
  );
});

test("a file is labelled by its name, not by where it sits", () => {
  assert.equal(fileName("artifacts/ci-unit/report.txt"), "report.txt");
  assert.equal(fileName("junit.xml"), "junit.xml");
});
