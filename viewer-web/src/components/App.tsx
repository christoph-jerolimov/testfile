import { useQuery, useQueryClient } from "@tanstack/react-query";
import React, { useEffect, useState } from "react";
import { api, runsQuery, subscribeRunsChanged, summaryQuery } from "../api.js";
import { navigate, parseRoute, type Route } from "../router.js";
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
  const [live, setLive] = useState(false);
  const client = useQueryClient();
  const { data: summary } = useQuery(summaryQuery);
  const { data: runs = [] } = useQuery(runsQuery);

  useEffect(() => {
    // Live updates: the server watches .testfile/runs/ and pings us. One
    // invalidation covers everything read from it - the runs, and the log
    // of whichever view is open, which re-reads itself rather than being
    // handed a counter to notice.
    return subscribeRunsChanged(() => void client.invalidateQueries({ queryKey: api }), setLive);
  }, [client]);

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
        <RunsView runs={runs} selected={route.runId} />
      ) : route.view === "test" && route.runId && route.testPath ? (
        <TestView runs={runs} runId={route.runId} testPath={route.testPath} />
      ) : (
        <TestsView runs={runs} selected={route.testPath} />
      )}
    </div>
  );
}
