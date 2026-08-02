import React, { useState } from "react";
import { countSummary, formatMs, startedLabel } from "../format.js";
import type { RunRecord } from "../types.js";
import { RunDetail } from "./RunDetail.js";
import { StatusCell } from "./StatusCell.js";

export function RunsView({ runs }: { runs: RunRecord[] }): React.ReactElement {
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
