import React, { useMemo, useState } from "react";
import { aggregate, formatMs, startedLabel } from "../format.js";
import type { RunRecord, RunTest } from "../types.js";
import { StatusCell } from "./StatusCell.js";

export function ResultsView({ runs }: { runs: RunRecord[] }): React.ReactElement {
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
                  {test.artifacts?.length ? (
                    <span className="badge">{test.artifacts.length} artifacts</span>
                  ) : null}
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
