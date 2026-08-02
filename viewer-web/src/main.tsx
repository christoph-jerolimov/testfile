import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";

// Mirrors runner-ts/src/history.ts RunRecord (the run.yaml contents).
interface RunTest {
  path: string;
  status: string;
  durationMs?: number;
  log?: string;
  artifacts?: string[];
  cached?: boolean;
}

interface RunRecord {
  id: string;
  startedAt: string;
  durationMs: number;
  status: "passed" | "failed" | "aborted";
  exitCode: number;
  cancelled: boolean;
  env: Record<string, string>;
  ports: Record<string, number>;
  selected: string[];
  tests: RunTest[];
}

interface Summary {
  name?: string;
  baseDir: string;
  runs: number;
}

function formatMs(ms?: number): string {
  if (ms === undefined) return "-";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m${Math.round((ms % 60_000) / 1000)}s`;
}

function startedLabel(iso: string): string {
  return iso.replace("T", " ").slice(0, 19);
}

function StatusCell({ status, cached }: { status: string; cached?: boolean }): React.ReactElement {
  const glyph =
    status === "passed" ? "✔" : status === "failed" || status === "aborted" ? "✘" : status === "skipped" ? "↷" : "·";
  return (
    <span className={`status-${status}`}>
      {glyph} {status}
      {cached ? <span className="badge">cached</span> : null}
    </span>
  );
}

function countSummary(run: RunRecord): string {
  const counts = new Map<string, number>();
  for (const test of run.tests) counts.set(test.status, (counts.get(test.status) ?? 0) + 1);
  return [...counts.entries()].map(([status, n]) => `${n} ${status}`).join(", ");
}

// Fetches text lazily and renders it as a log block.
function Log({ url }: { url: string }): React.ReactElement {
  const [text, setText] = useState<string | undefined>();
  useEffect(() => {
    let alive = true;
    setText(undefined);
    fetch(url)
      .then((response) => (response.ok ? response.text() : `(no log: ${response.status})`))
      .then((body) => {
        if (alive) setText(body);
      })
      .catch(() => alive && setText("(failed to load the log)"));
    return () => {
      alive = false;
    };
  }, [url]);
  return <pre className="log">{text ?? "loading..."}</pre>;
}

function RunDetail({ run }: { run: RunRecord }): React.ReactElement {
  const [logTest, setLogTest] = useState<string | undefined>();
  useEffect(() => setLogTest(undefined), [run.id]);
  const logUrl =
    logTest !== undefined
      ? `/api/runs/${run.id}/log?test=${encodeURIComponent(logTest)}`
      : `/api/runs/${run.id}/log`;
  return (
    <>
      <h2>
        run <span className="mono">{run.id}</span>
      </h2>
      <div className="meta">
        <StatusCell status={run.status} /> · started <b>{startedLabel(run.startedAt)}</b> · took{" "}
        <b>{formatMs(run.durationMs)}</b> · exit code <b>{run.exitCode}</b>
        {run.cancelled ? " · cancelled" : ""}
        {run.selected.length > 0 ? (
          <>
            {" "}
            · selected <b>{run.selected.join(", ")}</b>
          </>
        ) : null}
      </div>
      <table>
        <thead>
          <tr>
            <th>Test</th>
            <th>Status</th>
            <th>Duration</th>
            <th>Log</th>
          </tr>
        </thead>
        <tbody>
          {run.tests.map((test) => (
            <tr key={test.path} className={logTest === test.path ? "selected" : undefined}>
              <td className="mono">{test.path}</td>
              <td>
                <StatusCell status={test.status} cached={test.cached} />
              </td>
              <td>{formatMs(test.durationMs)}</td>
              <td>
                {test.log ? (
                  <button className="link" onClick={() => setLogTest(test.path)}>
                    show
                  </button>
                ) : (
                  <span className="status-skipped">-</span>
                )}
                {test.artifacts?.length ? (
                  <span className="badge">{test.artifacts.length} artifacts</span>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <h2 style={{ marginTop: "1.2rem" }}>
        {logTest !== undefined ? (
          <>
            log of <span className="mono">{logTest}</span>{" "}
            <button className="link" onClick={() => setLogTest(undefined)}>
              (show merged log)
            </button>
          </>
        ) : (
          "merged log"
        )}
      </h2>
      <Log url={logUrl} />
    </>
  );
}

function RunsView({ runs }: { runs: RunRecord[] }): React.ReactElement {
  const [selected, setSelected] = useState<string | undefined>();
  const run = runs.find((r) => r.id === selected) ?? runs[0];
  if (!run) return <div className="empty">no recorded runs yet — run some tests first</div>;
  return (
    <main>
      <div className="list">
        <table>
          <thead>
            <tr>
              <th>Started</th>
              <th>Status</th>
              <th>Duration</th>
              <th>Tests</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((r) => (
              <tr
                key={r.id}
                className={`row ${r.id === run.id ? "selected" : ""}`}
                onClick={() => setSelected(r.id)}
              >
                <td className="mono">{startedLabel(r.startedAt)}</td>
                <td>
                  <StatusCell status={r.status} />
                </td>
                <td>{formatMs(r.durationMs)}</td>
                <td>{countSummary(r)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="detail">
        <RunDetail run={run} />
      </div>
    </main>
  );
}

// Per-test aggregation across all runs (same idea as the TUI results view).
interface Aggregate {
  path: string;
  occurrences: number;
  passes: number;
  fails: number;
  lastStatus: string;
}

function aggregate(runs: RunRecord[]): Aggregate[] {
  const byPath = new Map<string, Aggregate>();
  for (const run of runs) {
    for (const test of run.tests) {
      let entry = byPath.get(test.path);
      if (!entry) {
        byPath.set(
          test.path,
          (entry = { path: test.path, occurrences: 0, passes: 0, fails: 0, lastStatus: test.status })
        );
      }
      entry.occurrences++;
      if (test.status === "passed") entry.passes++;
      if (test.status === "failed" || test.status === "aborted") entry.fails++;
    }
  }
  return [...byPath.values()];
}

function ResultsView({ runs }: { runs: RunRecord[] }): React.ReactElement {
  const tests = useMemo(() => aggregate(runs), [runs]);
  const [selected, setSelected] = useState<string | undefined>();
  const current = tests.find((t) => t.path === selected) ?? tests[0];
  if (!current) return <div className="empty">no recorded runs yet — run some tests first</div>;
  const executions = runs
    .map((run) => ({ run, test: run.tests.find((t) => t.path === current.path) }))
    .filter((entry): entry is { run: RunRecord; test: RunTest } => entry.test !== undefined);
  return (
    <main>
      <div className="list">
        <table>
          <thead>
            <tr>
              <th>Test</th>
              <th>Last</th>
              <th>Passed</th>
              <th>Failed</th>
              <th>Runs</th>
            </tr>
          </thead>
          <tbody>
            {tests.map((t) => (
              <tr
                key={t.path}
                className={`row ${t.path === current.path ? "selected" : ""}`}
                onClick={() => setSelected(t.path)}
              >
                <td className="mono">{t.path}</td>
                <td>
                  <StatusCell status={t.lastStatus} />
                </td>
                <td>{t.passes}</td>
                <td>{t.fails}</td>
                <td>{t.occurrences}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="detail">
        <h2>
          executions of <span className="mono">{current.path}</span>
        </h2>
        <table>
          <thead>
            <tr>
              <th>Run</th>
              <th>Started</th>
              <th>Status</th>
              <th>Duration</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            {executions.map(({ run, test }) => (
              <tr key={run.id}>
                <td className="mono">{run.id}</td>
                <td className="mono">{startedLabel(run.startedAt)}</td>
                <td>
                  <StatusCell status={test.status} cached={test.cached} />
                </td>
                <td>{formatMs(test.durationMs)}</td>
                <td>
                  {test.artifacts?.length ? <span className="badge">{test.artifacts.length} artifacts</span> : null}
                  {test.log ? <span className="badge">log</span> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}

function App(): React.ReactElement {
  const [view, setView] = useState<"runs" | "results">("runs");
  const [summary, setSummary] = useState<Summary | undefined>();
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [live, setLive] = useState(false);

  const refresh = (): void => {
    void fetch("/api/summary")
      .then((r) => r.json())
      .then(setSummary)
      .catch(() => undefined);
    void fetch("/api/runs")
      .then((r) => r.json())
      .then((body: { runs: RunRecord[] }) => setRuns(body.runs))
      .catch(() => undefined);
  };

  useEffect(() => {
    refresh();
    // live updates: the server watches .testfile/runs/ and pings us
    const events = new EventSource("/api/events");
    events.onopen = () => setLive(true);
    events.onerror = () => setLive(false);
    events.onmessage = (message) => {
      if (message.data === "runs-changed") refresh();
    };
    return () => events.close();
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

createRoot(document.getElementById("root")!).render(<App />);
