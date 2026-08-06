import React, { useMemo, useState } from "react";
import {
  filterTests,
  isDefaultTestFilter,
  tagOptions,
  tagsByPath,
  testFilterDefaults,
  testStatusOptions,
  type TestFilter,
} from "../filters.js";
import { aggregate, formatMs, isFlaky, startedLabel, variantLabel } from "../format.js";
import { navigate } from "../router.js";
import type { Aggregate, RunRecord, RunTest } from "../types.js";
import { columnHelper, DataTable, type Column } from "./DataTable.js";
import { FilterBar, MultiSelect, SearchInput, Toggle } from "./FilterBar.js";
import { Sparkline } from "./Sparkline.js";
import { StatusCell } from "./StatusCell.js";

// One recorded execution of a test: which run it came from, and what it did
// there. A merged run holds one result per leg, so a run can contribute more
// than one execution of the same test.
interface Execution {
  run: RunRecord;
  test: RunTest;
}

const tests = columnHelper<Aggregate>();
const executions = columnHelper<Execution>();

const testColumns: Column<Aggregate>[] = [
  tests.accessor("path", {
    header: "Test",
    sortFn: "alphanumeric",
    meta: { className: "mono" },
    cell: (info) => (
      <>
        {info.getValue()}
        {isFlaky(info.row.original) ? <span className="badge flaky">flaky</span> : null}
      </>
    ),
  }),
  tests.accessor("lastStatus", {
    header: "Last",
    sortFn: "alphanumeric",
    cell: (info) => <StatusCell status={info.getValue()} />,
  }),
  tests.accessor((test) => test.history.length, {
    id: "history",
    header: "History",
    sortFn: "basic",
    cell: (info) => <Sparkline history={info.row.original.history} />,
  }),
  tests.accessor("passes", { header: "Passed", sortFn: "basic" }),
  tests.accessor("fails", { header: "Failed", sortFn: "basic" }),
  tests.accessor("occurrences", { header: "Runs", sortFn: "basic" }),
];

const executionColumns: Column<Execution>[] = [
  executions.accessor((entry) => entry.run.id, {
    id: "run",
    header: "Run",
    sortFn: "alphanumeric",
    meta: { className: "mono" },
    cell: (info) => (
      <>
        {info.getValue()}
        {variantLabel(info.row.original.test.variants) ? (
          <span className="variant">{variantLabel(info.row.original.test.variants)}</span>
        ) : null}
      </>
    ),
  }),
  executions.accessor((entry) => entry.run.startedAt, {
    id: "started",
    header: "Started",
    sortFn: "datetime",
    meta: { className: "mono" },
    cell: (info) => startedLabel(info.getValue()),
  }),
  executions.accessor((entry) => entry.test.status, {
    id: "status",
    header: "Status",
    sortFn: "alphanumeric",
    cell: (info) => <StatusCell status={info.getValue()} cached={info.row.original.test.cached} />,
  }),
  executions.accessor((entry) => entry.test.durationMs ?? 0, {
    id: "duration",
    header: "Duration",
    sortFn: "basic",
    cell: (info) => formatMs(info.row.original.test.durationMs),
  }),
  executions.accessor((entry) => (entry.test.artifacts?.length ?? 0) + (entry.test.log ? 1 : 0), {
    id: "notes",
    header: "Notes",
    sortFn: "basic",
    cell: (info) => {
      const { test } = info.row.original;
      return (
        <>
          {test.artifacts?.length ? (
            <span className="badge">{test.artifacts.length} artifacts</span>
          ) : null}
          {test.log ? <span className="badge">log</span> : null}
        </>
      );
    },
  }),
];

export function ResultsView({
  runs,
  selected,
}: {
  runs: RunRecord[];
  // The test path from the URL; the first test stands in until one is picked.
  selected?: string;
}): React.ReactElement {
  const [filter, setFilter] = useState<TestFilter>(testFilterDefaults);
  const rows = useMemo(() => aggregate(runs), [runs]);
  const tags = useMemo(() => tagsByPath(runs), [runs]);
  const shown = useMemo(() => filterTests(rows, filter, tags), [rows, filter, tags]);
  // as on the runs tab, a linked test stays visible even when filtered out
  const current = rows.find((t) => t.path === selected) ?? shown[0] ?? rows[0];
  if (!current) return <div className="empty">no recorded runs yet — run some tests first</div>;
  const ran: Execution[] = runs.flatMap((run) =>
    run.tests.filter((t) => t.path === current.path).map((test) => ({ run, test })),
  );
  return (
    <main>
      <div className="list">
        <FilterBar
          shown={shown.length}
          total={rows.length}
          noun="tests"
          onClear={isDefaultTestFilter(filter) ? undefined : () => setFilter(testFilterDefaults)}
        >
          <MultiSelect
            label="Status"
            options={testStatusOptions(rows)}
            selected={filter.statuses}
            onChange={(statuses) => setFilter({ ...filter, statuses })}
          />
          <MultiSelect
            label="Tags"
            options={tagOptions(runs)}
            selected={filter.tags}
            onChange={(values) => setFilter({ ...filter, tags: values })}
          />
          <Toggle
            label="flaky only"
            on={filter.flakyOnly}
            onChange={(flakyOnly) => setFilter({ ...filter, flakyOnly })}
          />
          <SearchInput
            value={filter.text}
            placeholder="test path or tag"
            onChange={(text) => setFilter({ ...filter, text })}
          />
        </FilterBar>
        <DataTable
          columns={testColumns}
          data={shown}
          initialSorting={[{ id: "path", desc: false }]}
          rowKey={(t) => t.path}
          rowClassName={(t) => `row ${t.path === current.path ? "selected" : ""}`}
          onRowClick={(t) => navigate({ view: "results", testPath: t.path })}
          empty="no test matches the filters"
        />
      </div>
      <div className="detail">
        <h2>
          executions of <span className="mono">{current.path}</span>
          {isFlaky(current) ? <span className="badge flaky">flaky</span> : null}
          {(tags.get(current.path) ?? []).map((tag) => (
            <span key={tag} className="badge">
              {tag}
            </span>
          ))}
        </h2>
        <DataTable
          columns={executionColumns}
          data={ran}
          // newest first, as the runs list reads
          initialSorting={[{ id: "started", desc: true }]}
          rowKey={(entry) => `${entry.run.id} ${entry.test.origin ?? ""}`}
        />
      </div>
    </main>
  );
}
