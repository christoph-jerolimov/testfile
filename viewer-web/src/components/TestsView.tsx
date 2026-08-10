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
import { aggregate, formatMs, startedLabel, variantLabel, verdictOf } from "../format.js";
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

// A test is only labelled once it has enough results to judge; healthy
// tests say nothing, which keeps the table quiet.
function VerdictBadge({ test }: { test: Aggregate }): React.ReactElement | null {
  const verdict = verdictOf(test);
  if (verdict !== "flaky" && verdict !== "broken") return null;
  return <span className={`badge ${verdict}`}>{verdict}</span>;
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
        <VerdictBadge test={info.row.original} />
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

function executionColumns(showTest: boolean): Column<Execution>[] {
  const columns: Column<Execution>[] = [
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
  ];
  // Only "All tests" needs saying which test a row is.
  if (showTest) {
    columns.push(
      executions.accessor((entry) => entry.test.path, {
        id: "test",
        header: "Test",
        sortFn: "alphanumeric",
        meta: { className: "mono" },
      }),
    );
  }
  columns.push(
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
      cell: (info) => (
        <StatusCell status={info.getValue()} cached={info.row.original.test.cached} />
      ),
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
  );
  return columns;
}

export function TestsView({
  runs,
  selected,
}: {
  runs: RunRecord[];
  // The test path from the URL; without one, "All tests" is what shows.
  selected?: string;
}): React.ReactElement {
  const [filter, setFilter] = useState<TestFilter>(testFilterDefaults);
  const rows = useMemo(() => aggregate(runs), [runs]);
  const tags = useMemo(() => tagsByPath(runs), [runs]);
  const shown = useMemo(() => filterTests(rows, filter, tags), [rows, filter, tags]);
  if (rows.length === 0)
    return <div className="empty">no recorded runs yet — run some tests first</div>;
  // No selection means every test - the "All tests" row, like the TUI's.
  const current = selected !== undefined ? rows.find((t) => t.path === selected) : undefined;
  const ran: Execution[] = runs.flatMap((run) =>
    run.tests
      .filter((t) => current === undefined || t.path === current.path)
      .map((test) => ({ run, test })),
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
        <button
          className={`all-tests-row ${current === undefined ? "selected" : ""}`}
          onClick={() => navigate({ view: "tests" })}
        >
          All tests <span className="muted">({rows.length})</span>
        </button>
        <DataTable
          columns={testColumns}
          data={shown}
          initialSorting={[{ id: "path", desc: false }]}
          rowKey={(t) => t.path}
          rowClassName={(t) => `row ${t.path === current?.path ? "selected" : ""}`}
          onRowClick={(t) => navigate({ view: "tests", testPath: t.path })}
          empty="no test matches the filters"
        />
      </div>
      <div className="detail">
        <h2>
          executions of{" "}
          <span className="mono">{current === undefined ? "all tests" : current.path}</span>
          {current !== undefined ? <VerdictBadge test={current} /> : null}
          {(current !== undefined ? (tags.get(current.path) ?? []) : []).map((tag) => (
            <span key={tag} className="badge">
              {tag}
            </span>
          ))}
        </h2>
        <DataTable
          columns={executionColumns(current === undefined)}
          data={ran}
          // newest first, as the runs list reads
          initialSorting={[{ id: "started", desc: true }]}
          rowKey={(entry) => `${entry.run.id} ${entry.test.path} ${entry.test.origin ?? ""}`}
          rowClassName={() => "row"}
          // a click opens the execution's own page: that test in that run
          onRowClick={(entry) =>
            navigate({ view: "test", runId: entry.run.id, testPath: entry.test.path })
          }
        />
      </div>
    </main>
  );
}
