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
import { columnHelper, DataTable, type Column } from "./DataTable.js";
import { DayRange, FilterBar, MultiSelect, SearchInput } from "./FilterBar.js";
import { RunDetail } from "./RunDetail.js";
import { StatusCell } from "./StatusCell.js";

// A run's variants, or what a merged run combined - empty for a plain run.
function runVariants(run: RunRecord): string {
  return run.merged
    ? mergedVariantLabel(run.merged.variants) || `merged (${run.merged.runs.length} runs)`
    : variantLabel(run.variants);
}

const helper = columnHelper<RunRecord>();

// The number of tests a run recorded, so "Tests" sorts by size rather than
// by the text of its summary.
function testCount(run: RunRecord): number {
  return run.tests.length;
}

function runColumns(showVariants: boolean): Column<RunRecord>[] {
  const columns: Column<RunRecord>[] = [
    helper.accessor("startedAt", {
      header: "Started",
      sortFn: "datetime",
      meta: { className: "mono" },
      cell: (info) => startedLabel(info.getValue()),
    }),
    helper.accessor("status", {
      header: "Status",
      sortFn: "alphanumeric",
      cell: (info) => <StatusCell status={info.getValue()} />,
    }),
    helper.accessor((run) => run.durationMs ?? 0, {
      id: "duration",
      header: "Duration",
      sortFn: "basic",
      cell: (info) => formatMs(info.row.original.durationMs),
    }),
  ];
  // the column only earns its width when some run has variants
  if (showVariants) {
    columns.push(
      helper.accessor(runVariants, {
        id: "variants",
        header: "Variants",
        sortFn: "alphanumeric",
        cell: (info) =>
          info.getValue() ? <span className="variant">{info.getValue()}</span> : null,
      }),
    );
  }
  columns.push(
    helper.accessor(testCount, {
      id: "tests",
      header: "Tests",
      sortFn: "basic",
      cell: (info) => countSummary(info.row.original),
    }),
  );
  return columns;
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
  const showVariants = runs.some((r) => runVariants(r) !== "");
  const columns = useMemo(() => runColumns(showVariants), [showVariants]);
  // A linked run is shown even when the filters hide it from the list -
  // the link should not silently open something else.
  const run = runs.find((r) => r.id === selected) ?? shown[0] ?? runs[0];
  if (!run) return <div className="empty">no recorded runs yet — run some tests first</div>;
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
        <DataTable
          columns={columns}
          data={shown}
          // newest first, the order the history is written in
          initialSorting={[{ id: "startedAt", desc: true }]}
          rowKey={(r) => r.id}
          rowClassName={(r) => `row ${r.id === run.id ? "selected" : ""}`}
          onRowClick={(r) => navigate({ view: "runs", runId: r.id })}
          empty="no run matches the filters"
        />
      </div>
      <div className="detail">
        <RunDetail run={run} runs={runs} revision={revision} />
      </div>
    </main>
  );
}
