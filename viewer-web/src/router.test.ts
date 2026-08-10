import assert from "node:assert/strict";
import { test } from "node:test";
import { parseRoute, routePath } from "./router.js";

test("the path says which tab is open and what is selected", () => {
  assert.deepEqual(parseRoute("/"), { view: "runs" });
  assert.deepEqual(parseRoute("/runs"), { view: "runs" });
  assert.deepEqual(parseRoute("/runs/20260102-090000-fx02"), {
    view: "runs",
    runId: "20260102-090000-fx02",
  });
  assert.deepEqual(parseRoute("/tests"), { view: "tests" });
  assert.deepEqual(parseRoute("/tests/ci/checks/lint"), {
    view: "tests",
    testPath: "ci/checks/lint",
  });
  // one execution: that test in that run, as its own page
  assert.deepEqual(parseRoute("/runs/20260102-090000-fx02/tests/ci/unit"), {
    view: "test",
    runId: "20260102-090000-fx02",
    testPath: "ci/unit",
  });
  // anything else is the runs tab rather than a dead end
  assert.deepEqual(parseRoute("/nonsense"), { view: "runs" });
});

test("the tests tab used to be called results; old links keep working", () => {
  assert.deepEqual(parseRoute("/results"), { view: "tests" });
  assert.deepEqual(parseRoute("/results/ci/checks/lint"), {
    view: "tests",
    testPath: "ci/checks/lint",
  });
});

test("routePath is the inverse, and survives the round trip", () => {
  const routes = [
    { view: "runs" as const },
    { view: "runs" as const, runId: "20260102-090000-fx02" },
    { view: "tests" as const },
    { view: "tests" as const, testPath: "ci/checks/lint" },
    { view: "tests" as const, testPath: "m (node=22)/unit" },
    { view: "test" as const, runId: "20260102-090000-fx02", testPath: "ci/checks/lint" },
  ];
  for (const route of routes) {
    assert.deepEqual(parseRoute(routePath(route)), route, routePath(route));
  }
  assert.equal(routePath({ view: "tests", testPath: "ci/unit" }), "/tests/ci/unit");
  // a segment that would break the path is encoded, the separators are not
  assert.equal(
    routePath({ view: "tests", testPath: "m (node=22)/a b" }),
    "/tests/m%20(node%3D22)/a%20b",
  );
});
