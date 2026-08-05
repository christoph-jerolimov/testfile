// The URL is the state: which tab is open, which run or test is selected.
//
//   /                       the runs tab, newest run
//   /runs/<id>              that run
//   /results                the results tab
//   /results/<test/path>    that test's executions
//
// A test path contains slashes, so it is the rest of the path rather than a
// single encoded segment - /results/ci/checks/lint reads like the test does.
// `testfile-viewer serve` answers unknown paths with index.html, so every
// one of these is a link that can be shared, bookmarked and reloaded.

export interface Route {
  view: "runs" | "results";
  // Selected run id on the runs tab; undefined means "the newest one".
  runId?: string;
  // Selected test path on the results tab; undefined means "the first one".
  testPath?: string;
}

export function parseRoute(pathname: string): Route {
  const parts = pathname.split("/").filter(Boolean).map(decodeURIComponent);
  if (parts[0] === "results") {
    const testPath = parts.slice(1).join("/");
    return testPath ? { view: "results", testPath } : { view: "results" };
  }
  const runId = parts[0] === "runs" ? parts[1] : undefined;
  return runId ? { view: "runs", runId } : { view: "runs" };
}

export function routePath(route: Route): string {
  const encode = (value: string): string => value.split("/").map(encodeURIComponent).join("/");
  if (route.view === "results") {
    return route.testPath ? `/results/${encode(route.testPath)}` : "/results";
  }
  return route.runId ? `/runs/${encode(route.runId)}` : "/runs";
}

// Pushes a route without reloading; the same route replaces instead, so
// re-clicking a row does not pile up history entries.
export function navigate(route: Route): void {
  const path = routePath(route);
  if (path === window.location.pathname) return;
  window.history.pushState({}, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}
