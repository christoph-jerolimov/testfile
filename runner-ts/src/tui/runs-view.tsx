import React from "react";
import { Text } from "ink";
import type { RunRecord } from "../history.js";
import type { OutputLine } from "../output.js";
import type { Session } from "../session.js";
import { describeRun, runsTable, type PaneContent } from "./model.js";

const RUN_COLOR: Record<RunRecord["status"], string | undefined> = {
  passed: undefined,
  failed: "red",
  aborted: "magenta",
};

// All recorded runs as a table, newest first.
export function RunsPane({
  runs,
  index,
}: {
  runs: readonly RunRecord[];
  index: number;
}): React.ReactElement {
  const table = runsTable(runs);
  return (
    <>
      <Text bold color="cyan">
        RUNS
      </Text>
      {runs.length === 0 ? (
        <Text dimColor>no recorded runs yet</Text>
      ) : (
        <Text dimColor wrap="truncate">
          {table.header}
        </Text>
      )}
      {table.rows.map((row, i) => (
        <Text key={runs[i].id} inverse={i === index} color={RUN_COLOR[runs[i].status]} wrap="truncate">
          {row}
        </Text>
      ))}
    </>
  );
}

export function runsPaneContent(
  session: Session,
  run: RunRecord | undefined,
  showLog: boolean,
  cache: Map<string, OutputLine[]>
): PaneContent {
  if (!run) {
    return { title: "runs", lines: [{ text: "no recorded runs yet", stream: "system" }] };
  }
  return showLog
    ? { title: `run ${run.id}`, note: "merged log", lines: loadRunLog(session, run, cache) }
    : { title: `run ${run.id}`, note: "details — enter for the log", lines: describeRun(run) };
}

// Merged run logs for browsing, cached per run id.
export function loadRunLog(
  session: Session,
  run: RunRecord,
  cache: Map<string, OutputLine[]>
): OutputLine[] {
  let lines = cache.get(run.id);
  if (!lines) {
    const text = session.history.readRunLog(run) ?? "(no log recorded)";
    lines = text
      .split("\n")
      .filter((line, i, arr) => i < arr.length - 1 || line !== "")
      .map((line) => ({
        text: line.startsWith("# ") ? line.slice(2) : line,
        stream:
          line.startsWith("===") || line.startsWith("# ")
            ? ("system" as const)
            : ("stdout" as const),
      }));
    cache.set(run.id, lines);
  }
  return lines;
}
