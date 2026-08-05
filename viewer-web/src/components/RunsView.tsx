import React, { useMemo, useState } from "react";
import {
  filterRuns,
  isDefaultRunFilter,
  runFilterDefaults,
  statusOptions,
  variantOptions,
  type RunFilter,
} from "../filters.js";
import {
  countSummary,
  formatMs,
  mergedVariantLabel,
  startedLabel,
  variantLabel,
} from "../format.js";
import { navigate } from "../router.js";
import type { RunRecord } from "../types.js";
import { DayRange, FilterBar, MultiSelect, SearchInput } from "./FilterBar.js";
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
  revision,
}: {
  runs: RunRecord[];
  // The run id from the URL; the newest run stands in until one is picked.
  selected?: string;
  // Counts the server's change pings, so an open log is re-read.
  revision?: number;
}): React.ReactElement {
  const [filter, setFilter] = useState<RunFilter>(runFilterDefaults);
  const shown = useMemo(() => filterRuns(runs, filter), [runs, filter]);
  // A linked run is shown even when the filters hide it from the list -
  // the link should not silently open something else.
  const run = runs.find((r) => r.id === selected) ?? shown[0] ?? runs[0];
  if (!run) return <div className="empty">no recorded runs yet — run some tests first</div>;
  // the column only earns its width when some run has variants
  const showVariants = runs.some((r) => runVariants(r) !== "");
  return (
    <main>
      <div className="list">
        <FilterBar
          shown={shown.length}
          total={runs.length}
          noun="runs"
          onClear={isDefaultRunFilter(filter) ? undefined : () => setFilter(runFilterDefaults)}
        >
          <DayRange days={filter.days} onChange={(days) => setFilter({ ...filter, days })} />
          <MultiSelect
            label="Status"
            options={statusOptions(runs)}
            selected={filter.statuses}
            onChange={(statuses) => setFilter({ ...filter, statuses })}
          />
          <MultiSelect
            label="Variants"
            options={variantOptions(runs)}
            selected={filter.variants}
            onChange={(variants) => setFilter({ ...filter, variants })}
          />
          <SearchInput
            value={filter.text}
            placeholder="run id, test, variant"
            onChange={(text) => setFilter({ ...filter, text })}
          />
        </FilterBar>
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
            {shown.map((r) => (
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
            {shown.length === 0 ? (
              <tr>
                <td className="empty-row" colSpan={showVariants ? 5 : 4}>
                  no run matches the filters
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <div className="detail">
        <RunDetail run={run} runs={runs} revision={revision} />
      </div>
    </main>
  );
}
