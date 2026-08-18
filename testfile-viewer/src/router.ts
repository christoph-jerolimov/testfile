// The URL is the state: which tab is open, which run or test is selected.
//
//   /                             the runs tab, newest run
//   /runs/<id>                    that run
//   /runs/<id>/tests/<test/path>  one execution: that test in that run
//   /tests                        the tests tab
//   /tests/<test/path>            that test's executions
//
// A test path contains slashes, so it is the rest of the path rather than a
// single encoded segment - /tests/ci/checks/lint reads like the test does.
// `testfile-viewer serve` answers unknown paths with index.html, so every
// one of these is a link that can be shared, bookmarked and reloaded.
// The tests tab used to be called results; /results/... links keep working.

export interface Route {
  view: "runs" | "tests" | "test";
  // Selected run id on the runs tab; undefined means "the newest one".
  // On the test page it names the run of the execution shown.
  runId?: string;
  // Selected test path on the tests tab; undefined means "the first one".
  // On the test page it names the test of the execution shown.
  testPath?: string;
}

export function parseRoute(pathname: string): Route {
  const parts = pathname.split("/").filter(Boolean).map(decodeURIComponent);
  if (parts[0] === "tests" || parts[0] === "results") {
    const testPath = parts.slice(1).join("/");
    return testPath ? { view: "tests", testPath } : { view: "tests" };
  }
  if (parts[0] === "runs" && parts[1] && parts[2] === "tests" && parts[3]) {
    return { view: "test", runId: parts[1], testPath: parts.slice(3).join("/") };
  }
  const runId = parts[0] === "runs" ? parts[1] : undefined;
  return runId ? { view: "runs", runId } : { view: "runs" };
}

export function routePath(route: Route): string {
  const encode = (value: string): string => value.split("/").map(encodeURIComponent).join("/");
  if (route.view === "tests") {
    return route.testPath ? `/tests/${encode(route.testPath)}` : "/tests";
  }
  if (route.view === "test" && route.runId && route.testPath) {
    return `/runs/${encodeURIComponent(route.runId)}/tests/${encode(route.testPath)}`;
  }
  return route.runId ? `/runs/${encodeURIComponent(route.runId)}` : "/runs";
}

// Pushes a route without reloading; the same route replaces instead, so
// re-clicking a row does not pile up history entries.
export function navigate(route: Route): void {
  const path = routePath(route);
  if (path === window.location.pathname) return;
  window.history.pushState({}, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}
