import React, { useEffect, useState } from "react";
import { fetchRuns, fetchSummary, subscribeRunsChanged } from "../api.js";
import { navigate, parseRoute, type Route } from "../router.js";
import type { RunRecord, Summary } from "../types.js";
import { ResultsView } from "./ResultsView.js";
import { RunsView } from "./RunsView.js";

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

  const refresh = (): void => {
    void fetchSummary()
      .then(setSummary)
      .catch(() => undefined);
    void fetchRuns()
      .then(setRuns)
      .catch(() => undefined);
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
            className={route.view === "results" ? "active" : ""}
            onClick={() => navigate({ view: "results" })}
          >
            Results
          </button>
        </nav>
        <div className="live">
          {runs.length} runs {live ? <span className="dot">● live</span> : "○ offline"}
        </div>
      </header>
      {route.view === "runs" ? (
        <RunsView runs={runs} selected={route.runId} />
      ) : (
        <ResultsView runs={runs} selected={route.testPath} />
      )}
    </div>
  );
}
