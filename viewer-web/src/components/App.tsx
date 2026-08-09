import React, { useEffect, useState } from "react";
import { fetchRuns, fetchSummary, subscribeRunsChanged } from "../api.js";
import { navigate, parseRoute, type Route } from "../router.js";
import type { RunRecord, Summary } from "../types.js";
import { RunsView } from "./RunsView.js";
import { TestsView } from "./TestsView.js";
import { TestView } from "./TestView.js";

// The route is the only navigation state, so the back button, a reload and a
// shared link all land in the same place.
function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.pathname));
  useEffect(() => {
    const onPop = (): void => setRoute(parseRoute(window.location.pathname));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  return route;
}

export function App(): React.ReactElement {
  const route = useRoute();
  const [summary, setSummary] = useState<Summary | undefined>();
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [live, setLive] = useState(false);
  // Bumped on every server ping. Views that read something the API does not
  // hand out with the runs - a log - use it to re-read.
  const [revision, setRevision] = useState(0);

  const refresh = (): void => {
    void fetchSummary()
      .then(setSummary)
      .catch(() => undefined);
    void fetchRuns()
      .then(setRuns)
      .catch(() => undefined);
    setRevision((current) => current + 1);
  };

  useEffect(() => {
    refresh();
    // live updates: the server watches .testfile/runs/ and pings us
    return subscribeRunsChanged(refresh, setLive);
  }, []);

  return (
    <div className="app">
      <header>
        <h1>
          <span>Testfile</span> {summary?.name ?? ""}
        </h1>
        <nav>
          <button
            className={route.view === "runs" ? "active" : ""}
            onClick={() => navigate({ view: "runs" })}
          >
            Runs
          </button>
          <button
            className={route.view === "tests" || route.view === "test" ? "active" : ""}
            onClick={() => navigate({ view: "tests" })}
          >
            Tests
          </button>
        </nav>
        <div className="live">
          {runs.length} runs {live ? <span className="dot">● live</span> : "○ offline"}
        </div>
      </header>
      {route.view === "runs" ? (
        <RunsView runs={runs} selected={route.runId} revision={revision} />
      ) : route.view === "test" && route.runId && route.testPath ? (
        <TestView runs={runs} runId={route.runId} testPath={route.testPath} revision={revision} />
      ) : (
        <TestsView runs={runs} selected={route.testPath} />
      )}
    </div>
  );
}
