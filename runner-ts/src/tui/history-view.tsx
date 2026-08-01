import React from "react";
import { Text } from "ink";
import type { RunRecord } from "../history.js";
import type { OutputLine } from "../output.js";
import type { Session } from "../session.js";
import { describeRun, runListLabel, type PaneContent } from "./model.js";

export function HistoryPane({
  runs,
  index,
}: {
  runs: readonly RunRecord[];
  index: number;
}): React.ReactElement {
  return (
    <>
      <Text bold color="cyan">
        RUNS
      </Text>
      {runs.length === 0 ? <Text dimColor>no recorded runs yet</Text> : null}
      {runs.map((run, i) => (
        <Text key={run.id} inverse={i === index} wrap="truncate">
          {runListLabel(run)}
        </Text>
      ))}
    </>
  );
}

export function historyPaneContent(
  session: Session,
  run: RunRecord | undefined,
  showLog: boolean,
  cache: Map<string, OutputLine[]>
): PaneContent {
  if (!run) {
    return { title: "history", lines: [{ text: "no recorded runs yet", stream: "system" }] };
  }
  return showLog
    ? { title: `run ${run.id}`, note: "merged log", lines: loadRunLog(session, run, cache) }
    : { title: `run ${run.id}`, note: "details — enter for the log", lines: describeRun(run) };
}

// Merged run logs for history browsing, cached per run id.
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
