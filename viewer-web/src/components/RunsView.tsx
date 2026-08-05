import React from "react";
import {
  countSummary,
  formatMs,
  mergedVariantLabel,
  startedLabel,
  variantLabel,
} from "../format.js";
import { navigate } from "../router.js";
import type { RunRecord } from "../types.js";
import { RunDetail } from "./RunDetail.js";
import { StatusCell } from "./StatusCell.js";

// A run's variants, or what a merged run combined - empty for a plain run.
function runVariants(run: RunRecord): string {
  return run.merged
    ? mergedVariantLabel(run.merged.variants) || `merged (${run.merged.runs.length} runs)`
    : variantLabel(run.variants);
}

export function RunsView({
  runs,
  selected,
}: {
  runs: RunRecord[];
  // The run id from the URL; the newest run stands in until one is picked.
  selected?: string;
}): React.ReactElement {
  const run = runs.find((r) => r.id === selected) ?? runs[0];
  if (!run) return <div className="empty">no recorded runs yet — run some tests first</div>;
  // the column only earns its width when some run has variants
  const showVariants = runs.some((r) => runVariants(r) !== "");
  return (
    <main>
      <div className="list">
        <table>
          <thead>
            <tr>
              <th>Started</th>
              <th>Status</th>
              <th>Duration</th>
              {showVariants ? <th>Variants</th> : null}
              <th>Tests</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((r) => (
              <tr
                key={r.id}
                className={`row ${r.id === run.id ? "selected" : ""}`}
                onClick={() => navigate({ view: "runs", runId: r.id })}
              >
                <td className="mono">{startedLabel(r.startedAt)}</td>
                <td>
                  <StatusCell status={r.status} />
                </td>
                <td>{formatMs(r.durationMs)}</td>
                {showVariants ? (
                  <td>
                    {runVariants(r) ? <span className="variant">{runVariants(r)}</span> : null}
                  </td>
                ) : null}
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
