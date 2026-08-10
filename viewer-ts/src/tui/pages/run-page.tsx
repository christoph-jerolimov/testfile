// The run detail page: the suite as a tree table on the left, the selected
// node's detail tabs on the right. Narrow terminals show only the tree and
// push the detail as its own page.
import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import type { RunHistory } from "../../runrecord.js";
import { formatMs } from "../../util.js";
import { DetailTabs } from "../detail-tabs.js";
import { useEscape } from "../interaction.js";
import { suiteRows, type SuiteRow } from "../model.js";
import { isMouseSequence } from "../mouse.js";
import { useNavigation } from "../navigation.js";
import { PageShell, SplitPanel, useScreen } from "../panels.js";
import { DataTable, type ColumnSpec } from "../table.js";
import { statusGlyph } from "../theme.js";

const TREE_COLUMNS: ColumnSpec<SuiteRow>[] = [
  {
    id: "test",
    header: "TEST",
    // sort by full path so an ordered column still reads hierarchically
    value: (row) => row.path,
    text: (row) => `${"  ".repeat(row.depth)}${row.name}`,
  },
  {
    id: "status",
    header: "STATUS",
    width: 9,
    value: (row) => row.status ?? "",
    text: (row) => (row.status ? `${statusGlyph(row.status).glyph} ${row.status}` : ""),
    color: (row) => (row.status ? statusGlyph(row.status).color : undefined),
  },
  {
    id: "duration",
    header: "DURATION",
    width: 8,
    align: "right",
    value: (row) => row.durationMs,
    text: (row) => (row.durationMs !== undefined ? formatMs(row.durationMs) : ""),
  },
  {
    id: "started",
    header: "START",
    width: 7,
    align: "right",
    value: (row) => row.startedAfterMs,
    text: (row) => (row.startedAfterMs !== undefined ? `+${formatMs(row.startedAfterMs)}` : ""),
  },
];

export function RunPage({
  history,
  runId,
}: {
  history: RunHistory;
  runId: string;
}): React.ReactElement {
  const navigation = useNavigation();
  const { rows, columns, narrow } = useScreen();
  const [side, setSide] = useState<"table" | "detail">("table");
  const [selected, setSelected] = useState<SuiteRow | undefined>();

  const run = history.runs.find((r) => r.id === runId);

  // → focuses the detail; ←/→ inside it pan the log, so the way back from
  // the detail is escape (claimed below), not the left arrow.
  useInput(
    (input, key) => {
      if (isMouseSequence(input)) return;
      if (key.rightArrow && !narrow && side === "table") setSide("detail");
    },
    { isActive: run !== undefined },
  );
  useEscape("run-side", side === "detail" && !narrow, () => setSide("table"));

  if (!run) {
    return (
      <PageShell breadcrumb={["Runs", runId]}>
        <Box>
          <Text color="red">run {runId} is no longer recorded</Text>
        </Box>
      </PageShell>
    );
  }

  const tree = suiteRows(run);
  const bodyHeight = rows - 2 - 3;
  const width = columns - 1;
  // Wide enough that the tree's fixed columns (status, duration, start)
  // never overflow and truncate at the right edge.
  const leftWidth = narrow ? width : Math.max(46, Math.floor(width * 0.45));
  const rightWidth = width - leftWidth - 1;
  // The selected node's path; the tree root means "the run itself".
  const path = selected && selected.depth > 0 ? selected.path : undefined;

  const left = (
    <DataTable
      id="run-tree"
      title="Suite"
      stateKey={`run-tree:${runId}`}
      data={tree}
      columns={TREE_COLUMNS}
      height={bodyHeight}
      width={leftWidth}
      focused={narrow || side === "table"}
      onCursor={(row) => setSelected(row)}
      onActivate={(row) => {
        if (narrow) {
          navigation.push({
            kind: "run-node",
            runId,
            path: row.depth > 0 ? row.path : undefined,
          });
        } else setSide("detail");
      }}
      extraShortcuts={
        narrow
          ? [{ keys: "enter/click", label: "details" }]
          : [{ keys: "enter/→", label: "to details" }]
      }
    />
  );

  const right = (
    <DetailTabs
      id="run-detail"
      history={history}
      run={run}
      path={path}
      height={bodyHeight}
      width={rightWidth}
      focused={side === "detail" && !narrow}
    />
  );

  return (
    <PageShell breadcrumb={["Runs", run.id]}>
      <Text dimColor>
        {run.startedAt.replace("T", " ").slice(0, 19)} · {run.status} · {formatMs(run.durationMs)} ·
        esc back
      </Text>
      <SplitPanel left={left} right={right} leftWidth={leftWidth} />
    </PageShell>
  );
}

// Narrow-mode detail for one tree node: the same tabs, as a page.
export function RunNodePage({
  history,
  runId,
  path,
}: {
  history: RunHistory;
  runId: string;
  path?: string;
}): React.ReactElement {
  const { rows, columns } = useScreen();
  const run = history.runs.find((r) => r.id === runId);
  if (!run) {
    return (
      <PageShell breadcrumb={["Runs", runId]}>
        <Text color="red">run {runId} is no longer recorded</Text>
      </PageShell>
    );
  }
  return (
    <PageShell breadcrumb={["Runs", run.id, path ?? "run"]}>
      <DetailTabs
        id="run-node"
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
