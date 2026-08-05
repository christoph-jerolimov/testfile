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
  assert.deepEqual(parseRoute("/results"), { view: "results" });
  assert.deepEqual(parseRoute("/results/ci/checks/lint"), {
    view: "results",
    testPath: "ci/checks/lint",
  });
  // anything else is the runs tab rather than a dead end
  assert.deepEqual(parseRoute("/nonsense"), { view: "runs" });
});

test("routePath is the inverse, and survives the round trip", () => {
  const routes = [
    { view: "runs" as const },
    { view: "runs" as const, runId: "20260102-090000-fx02" },
    { view: "results" as const },
    { view: "results" as const, testPath: "ci/checks/lint" },
    { view: "results" as const, testPath: "m (node=22)/unit" },
  ];
  for (const route of routes) {
    assert.deepEqual(parseRoute(routePath(route)), route, routePath(route));
  }
  assert.equal(routePath({ view: "results", testPath: "ci/unit" }), "/results/ci/unit");
  // a segment that would break the path is encoded, the separators are not
  assert.equal(
    routePath({ view: "results", testPath: "m (node=22)/a b" }),
    "/results/m%20(node%3D22)/a%20b",
  );
});
