// The index page: the Runs tab (the full-width runs table with filter and
// sorting) and the Tests tab (every recorded test on the left as a filter,
// its executions on the right).
import React, { useMemo, useState } from "react";
import { Box, Text, useInput } from "ink";
import {
  formatMs,
  type RecordedTest,
  recordedTests,
  type RunHistory,
  type RunRecord,
  type TestRunRow,
  testRunsFor,
  variantLabel,
} from "@testfile.dev/core";
import { useEscape, useTextInput } from "../interaction.js";
import { isMouseSequence } from "../mouse.js";
import { useNavigation } from "../navigation.js";
import { PageShell, SplitPanel, TabStrip, useScreen } from "../panels.js";
import { useShortcuts } from "../statusbar.js";
import { DataTable, type ColumnSpec } from "../table.js";
import { statusGlyph, verdictColor } from "../theme.js";
import { useViewState } from "../view-state.js";

function runVariants(run: RunRecord): string {
  return run.merged
    ? Object.entries(run.merged.variants ?? {})
        .map(([key, values]) => `${key}=${values.join("|")}`)
        .join(", ") || `merged (${run.merged.runs.length})`
    : variantLabel(run.variants);
}

function statusCount(run: RunRecord, status: string): number {
  return run.tests.filter((test) => test.status === status).length;
}

// Every status beyond passed/failed, spelled out: "2 skipped, 1 aborted".
function otherSummary(run: RunRecord): string {
  const counts = new Map<string, number>();
  for (const test of run.tests) {
    if (test.status === "passed" || test.status === "failed") continue;
    counts.set(test.status, (counts.get(test.status) ?? 0) + 1);
  }
  return [...counts.entries()].map(([status, n]) => `${n} ${status}`).join(", ");
}

function testSummary(run: RunRecord): string {
  const counts = new Map<string, number>();
  for (const test of run.tests) counts.set(test.status, (counts.get(test.status) ?? 0) + 1);
  return [...counts.entries()].map(([status, n]) => `${n} ${status}`).join(", ");
}

const RUN_COLUMNS: ColumnSpec<RunRecord>[] = [
  {
    id: "started",
    header: "STARTED",
    width: 19,
    value: (run) => run.startedAt,
    text: (run) => run.startedAt.replace("T", " ").slice(0, 19),
  },
  { id: "run", header: "RUN", width: 20, value: (run) => run.id },
  {
    id: "status",
    header: "STATUS",
    width: 9,
    value: (run) => run.status,
    text: (run) => `${statusGlyph(run.status).glyph} ${run.status}`,
    color: (run) => statusGlyph(run.status).color,
  },
  {
    id: "duration",
    header: "DURATION",
    width: 8,
    align: "right",
    value: (run) => run.durationMs,
    text: (run) => formatMs(run.durationMs),
  },
  {
    id: "passed",
    header: "PASSED",
    width: 6,
    align: "right",
    value: (run) => statusCount(run, "passed"),
    text: (run) => String(statusCount(run, "passed") || ""),
    color: (run) => (statusCount(run, "passed") > 0 ? "green" : undefined),
  },
  {
    id: "failed",
    header: "FAILED",
    width: 6,
    align: "right",
    value: (run) => statusCount(run, "failed"),
    text: (run) => String(statusCount(run, "failed") || ""),
    color: (run) => (statusCount(run, "failed") > 0 ? "red" : undefined),
  },
  {
    id: "others",
    header: "OTHERS",
    value: (run) => otherSummary(run),
    dim: () => true,
  },
  { id: "variants", header: "VARIANTS", value: runVariants },
];

// The runs tab: filter line + the table taking all the space.
function RunsTab({
  history,
  height,
  width,
}: {
  history: RunHistory;
  height: number;
  width: number;
}): React.ReactElement {
  const navigation = useNavigation();
  const [filtering, setFiltering] = useState(false);
  const [query, setQuery] = useState("");

  useEscape("runs-filter", filtering || query !== "", () => {
    setFiltering(false);
    setQuery("");
  });
  useTextInput("runs-filter", filtering);
  useInput(
    (input, key) => {
      if (isMouseSequence(input)) return;
      if (filtering) {
        if (key.return) setFiltering(false);
        else if (key.backspace || key.delete) setQuery((q) => q.slice(0, -1));
        else if (input && !key.ctrl && !key.meta && !key.tab) setQuery((q) => q + input);
        return;
      }
      if (input === "/") setFiltering(true);
    },
    { isActive: true },
  );

  const runs = useMemo(() => {
    if (query === "") return history.runs;
    const q = query.toLowerCase();
    return history.runs.filter((run) =>
      [
        run.id,
        run.status,
        run.startedAt,
        runVariants(run),
        variantLabel(run.labels),
        testSummary(run),
      ]
        .join(" ")
        .toLowerCase()
        .includes(q),
    );
  }, [history.runs, query]);

  return (
    <Box flexDirection="column">
      <Text>
        {filtering || query !== "" ? (
          <>
            <Text color="cyan">filter: </Text>
            {query}
            {filtering ? <Text inverse> </Text> : <Text dimColor> (esc clears)</Text>}
          </>
        ) : (
          <Text dimColor>{history.runs.length} recorded runs</Text>
        )}
      </Text>
      <DataTable
        id="runs-table"
        title="Runs"
        data={runs}
        columns={RUN_COLUMNS}
        height={height - 1}
        width={width}
        focused={!filtering}
        onActivate={(run) => navigation.push({ kind: "run", runId: run.id })}
        activateOnClick
        extraShortcuts={[
          { keys: "enter/click", label: "open run" },
          { keys: "/", label: "filter" },
        ]}
        emptyText="no recorded runs - start one with `testfile start`"
      />
    </Box>
  );
}

// The left table of the Tests tab: "All tests" plus every recorded path.
interface TestFilterRow {
  path?: string;
  label: string;
  runs?: number;
  fails?: number;
  verdict?: string;
}

const TEST_COLUMNS: ColumnSpec<TestFilterRow>[] = [
  { id: "test", header: "TEST", value: (row) => row.label },
  { id: "runs", header: "RUNS", width: 5, align: "right", value: (row) => row.runs },
  { id: "fails", header: "FAILS", width: 5, align: "right", value: (row) => row.fails },
  {
    id: "verdict",
    header: "VERDICT",
    width: 8,
    value: (row) => row.verdict,
    color: (row) => verdictColor(row.verdict),
    // "unknown" is the absence of a verdict; keep it quiet
    dim: (row) => row.verdict === "unknown",
  },
];

const TEST_RUN_COLUMNS: ColumnSpec<TestRunRow>[] = [
  {
    id: "run",
    header: "RUN",
    width: 20,
    value: (row) => row.runId,
  },
  {
    id: "test",
    header: "TEST",
    value: (row) => row.path,
  },
  {
    id: "status",
    header: "STATUS",
    width: 9,
    value: (row) => row.status,
    text: (row) => `${statusGlyph(row.status).glyph} ${row.status}`,
    color: (row) => statusGlyph(row.status).color,
  },
  {
    id: "duration",
    header: "DURATION",
    width: 8,
    align: "right",
    value: (row) => row.durationMs,
    text: (row) => (row.durationMs !== undefined ? formatMs(row.durationMs) : "-"),
  },
  {
    id: "notes",
    header: "NOTES",
    width: 16,
    value: (row) =>
      [row.cached ? "cached" : "", row.artifacts ? `${row.artifacts} artifacts` : ""]
        .filter(Boolean)
        .join(", "),
  },
];

function TestsTab({
  history,
  height,
  width,
}: {
  history: RunHistory;
  height: number;
  width: number;
}): React.ReactElement {
  const navigation = useNavigation();
  const { narrow } = useScreen();
  const [focus, setFocus] = useViewState<"left" | "right">("tests:focus", "left");
  const [selected, setSelected] = useState<TestFilterRow | undefined>();

  const tests = useMemo<TestFilterRow[]>(() => {
    const rows = recordedTests(history).map((test: RecordedTest) => ({
      path: test.path,
      label: test.path,
      runs: test.occurrences,
      fails: test.fails,
      verdict: test.verdict,
    }));
    return [{ label: "All tests" }, ...rows];
  }, [history, history.runs]);

  const executions = useMemo(
    () => testRunsFor(history, selected?.path),
    [history, history.runs, selected?.path],
  );

  useInput(
    (input, key) => {
      if (isMouseSequence(input)) return;
      if (key.leftArrow && !narrow) setFocus("left");
      else if (key.rightArrow && !narrow) setFocus("right");
    },
    { isActive: true },
  );
  useEscape("tests-focus", focus === "right" && !narrow, () => setFocus("left"));

  const leftWidth = narrow ? width : Math.max(30, Math.floor(width * 0.45));
  const rightWidth = width - leftWidth - 1;

  const left = (
    <DataTable
      id="tests-table"
      title="Tests"
      data={tests}
      columns={narrow ? TEST_COLUMNS : TEST_COLUMNS.map((c, i) => (i === 0 ? c : { ...c }))}
      height={height}
      width={leftWidth}
      focused={narrow || focus === "left"}
      onCursor={(row) => setSelected(row)}
      onActivate={(row) => {
        if (narrow) navigation.push({ kind: "test-runs", path: row.path });
        else setFocus("right");
      }}
      extraShortcuts={
        narrow
          ? [{ keys: "enter/click", label: "executions" }]
          : [
              { keys: "enter/→", label: "to executions" },
              { keys: "click", label: "select" },
            ]
      }
    />
  );

  const right = (
    <DataTable
      id="test-runs-table"
      title="Executions"
      stateKey={`executions:${selected?.path ?? "all"}`}
      data={executions}
      columns={TEST_RUN_COLUMNS}
      height={height}
      width={rightWidth}
      focused={focus === "right" && !narrow}
      onActivate={(row) => navigation.push({ kind: "test", runId: row.runId, path: row.path })}
      activateOnClick
      extraShortcuts={[
        { keys: "enter/click", label: "open test" },
        { keys: "esc/←", label: "back to tests" },
      ]}
      emptyText="no executions recorded"
    />
  );

  return <SplitPanel left={left} right={right} leftWidth={leftWidth} />;
}

export function IndexPage({
  history,
  initialTab = "runs",
}: {
  history: RunHistory;
  initialTab?: "runs" | "tests";
}): React.ReactElement {
  const { rows, columns } = useScreen();
  const [tab, setTab] = useViewState<"runs" | "tests">("index:tab", initialTab);

  useInput(
    (input, key) => {
      if (isMouseSequence(input)) return;
      if (key.tab) setTab(tab === "runs" ? "tests" : "runs");
      else if (input === "1") setTab("runs");
      else if (input === "2") setTab("tests");
    },
    { isActive: true },
  );
  useShortcuts("index-tabs", "Tabs", [{ keys: "tab / 1 2", label: "switch tab" }], true);

  // shell chrome: breadcrumb + status line; page chrome: tab strip + table
  // header + count line.
  const bodyHeight = rows - 2 - 1 - 3;
  const width = columns - 1;
  return (
    <PageShell breadcrumb={[tab === "runs" ? "Runs" : "Tests"]}>
      <TabStrip
        tabs={[
          { id: "runs", label: "Runs" },
          { id: "tests", label: "Tests" },
        ]}
        active={tab}
      />
      {tab === "runs" ? (
        <RunsTab history={history} height={bodyHeight} width={width} />
      ) : (
        <TestsTab history={history} height={bodyHeight} width={width} />
      )}
    </PageShell>
  );
}
