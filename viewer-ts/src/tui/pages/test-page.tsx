// The dedicated test page (one test in one run) and the narrow-mode
// executions page that leads to it from the Tests tab.
import React from "react";
import { Text } from "ink";
import type { RunHistory } from "../../runrecord.js";
import { formatMs } from "../../util.js";
import { DetailTabs } from "../detail-tabs.js";
import { testRunsFor, type TestRunRow } from "../model.js";
import { useNavigation } from "../navigation.js";
import { PageShell, useScreen } from "../panels.js";
import { DataTable, type ColumnSpec } from "../table.js";
import { statusGlyph } from "../theme.js";

export function TestPage({
  history,
  runId,
  path,
}: {
  history: RunHistory;
  runId: string;
  path: string;
}): React.ReactElement {
  const { rows, columns } = useScreen();
  const run = history.runs.find((r) => r.id === runId);
  if (!run) {
    return (
      <PageShell breadcrumb={["Tests", path, runId]}>
        <Text color="red">run {runId} is no longer recorded</Text>
      </PageShell>
    );
  }
  return (
    <PageShell breadcrumb={["Tests", path, run.id]}>
      <DetailTabs
        id="test-page"
        history={history}
        run={run}
        path={path}
        height={rows - 2 - 1}
        width={columns - 1}
        focused
      />
    </PageShell>
  );
}

const EXECUTION_COLUMNS: ColumnSpec<TestRunRow>[] = [
  { id: "run", header: "RUN", width: 20, value: (row) => row.runId },
  { id: "test", header: "TEST", value: (row) => row.path },
  {
    id: "status",
    header: "STATUS",
    width: 9,
    value: (row) => row.status,
    text: (row) => `${statusGlyph(row.status).glyph} ${row.status}`,
  },
  {
    id: "duration",
    header: "DURATION",
    width: 8,
    align: "right",
    value: (row) => row.durationMs,
    text: (row) => (row.durationMs !== undefined ? formatMs(row.durationMs) : "-"),
  },
];

// Narrow terminals: the Tests tab's right panel as its own page.
export function TestRunsPage({
  history,
  path,
}: {
  history: RunHistory;
  path?: string;
}): React.ReactElement {
  const navigation = useNavigation();
  const { rows, columns } = useScreen();
  return (
    <PageShell breadcrumb={["Tests", path ?? "All tests"]}>
      <DataTable
        id="test-runs-page"
        title="Executions"
        data={testRunsFor(history, path)}
        columns={EXECUTION_COLUMNS}
        height={rows - 2 - 3}
        width={columns - 1}
        focused
        onActivate={(row) => navigation.push({ kind: "test", runId: row.runId, path: row.path })}
        activateOnClick
        extraShortcuts={[{ keys: "enter/click", label: "open test" }]}
        emptyText="no executions recorded"
      />
    </PageShell>
  );
}
