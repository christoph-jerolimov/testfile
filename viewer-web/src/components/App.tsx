import React, { useEffect, useState } from "react";
import { fetchRuns, fetchSummary, subscribeRunsChanged } from "../api.js";
import type { RunRecord, Summary } from "../types.js";
import { ResultsView } from "./ResultsView.js";
import { RunsView } from "./RunsView.js";

export function App(): React.ReactElement {
  const [view, setView] = useState<"runs" | "results">("runs");
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
          <button className={view === "runs" ? "active" : ""} onClick={() => setView("runs")}>
            Runs
          </button>
          <button className={view === "results" ? "active" : ""} onClick={() => setView("results")}>
            Results
          </button>
        </nav>
        <div className="live">
          {runs.length} runs {live ? <span className="dot">● live</span> : "○ offline"}
        </div>
      </header>
      {view === "runs" ? <RunsView runs={runs} /> : <ResultsView runs={runs} />}
    </div>
  );
}
