// The read-only viewer TUI: recorded runs and per-test results, watching
// .testfile/runs/ for changes. It never starts tests - that is the
// runner's job (`testfile run`).
import React, { useEffect, useRef, useState } from "react";
import { Box, Text, useApp, useInput, useStdout } from "ink";
import type { RunHistory, RunRecord } from "../runrecord.js";
import {
  describeRun,
  findMatches,
  logToLines,
  logWindow,
  recordedTests,
  runsTable,
  scrollToLine,
  testHistoryLines,
  type OutputLine,
  type PaneContent,
} from "./model.js";
import { isMouseSequence, parseWheelEvents, type WheelEvent } from "./mouse.js";
import { watchRuns } from "./watch-runs.js";

export type ViewerView = "runs" | "results";

const RUN_COLOR: Record<RunRecord["status"], string | undefined> = {
  passed: undefined,
  failed: "red",
  aborted: "magenta",
};

const STATUS_GLYPH: Record<string, { glyph: string; color: string }> = {
  passed: { glyph: "✔", color: "green" },
  failed: { glyph: "✘", color: "red" },
  aborted: { glyph: "■", color: "magenta" },
  skipped: { glyph: "↷", color: "gray" },
};

export function App({
  history,
  baseDir,
  name,
  initialView = "runs",
}: {
  history: RunHistory;
  baseDir: string;
  name?: string;
  initialView?: ViewerView;
}): React.ReactElement {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const [, setTick] = useState(0);
  const [view, setView] = useState<ViewerView>(initialView);
  const [runsCursor, setRunsCursor] = useState(0);
  const [runLog, setRunLog] = useState(false);
  const [resultsCursor, setResultsCursor] = useState(0);
  const [logScroll, setLogScroll] = useState(0);
  const [wrap, setWrap] = useState(false);
  const [logSearchInput, setLogSearchInput] = useState(false);
  const [logQuery, setLogQuery] = useState("");
  const [matchPos, setMatchPos] = useState(0);
  const [message, setMessage] = useState<string | undefined>();
  const runLogs = useRef(new Map<string, OutputLine[]>());

  // Watch the runs folder: runs recorded by any process appear live.
  useEffect(
    () =>
      watchRuns(baseDir, () => {
        history.reload();
        runLogs.current.clear();
        setTick((t) => t + 1);
      }),
    [history, baseDir]
  );

  const runs = history.runs;
  const runsIndex = Math.min(runsCursor, Math.max(0, runs.length - 1));
  const recorded = recordedTests(history);
  const resultsIndex = Math.min(resultsCursor, Math.max(0, recorded.length - 1));

  const currentRun = runs[runsIndex];
  const currentTest = recorded[resultsIndex];
  const pane: PaneContent =
    view === "runs"
      ? currentRun
        ? runLog
          ? {
              title: `run ${currentRun.id}`,
              note: "merged log",
              lines: loadRunLog(history, currentRun, runLogs.current),
            }
          : { title: `run ${currentRun.id}`, note: "details — enter for the log", lines: describeRun(currentRun) }
        : { title: "runs", lines: [{ text: "no recorded runs yet", stream: "system" }] }
      : currentTest
        ? {
            title: currentTest.path,
            note: "all recorded executions",
            lines: testHistoryLines(currentTest.path, history),
          }
        : { title: "results", lines: [{ text: "no recorded runs yet", stream: "system" }] };

  const height = (stdout?.rows ?? 30) - 2;
  const outputHeight = Math.max(5, height - 5);
  const logMatches = findMatches(pane.lines, logQuery);
  const matchIndex = Math.min(matchPos, Math.max(0, logMatches.length - 1));
  const currentMatchLine = logMatches.length > 0 ? logMatches[matchIndex] : undefined;

  const jumpToMatch = (position: number): void => {
    setMatchPos(position);
    const line = logMatches[position];
    if (line !== undefined) setLogScroll(scrollToLine(pane.lines.length, outputHeight, line));
  };

  const onWheel = useRef<(event: WheelEvent) => void>(() => {});
  onWheel.current = (event) => {
    setLogScroll((s) => (event.direction === "up" ? s + 3 : Math.max(0, s - 3)));
  };

  useInput((input, key) => {
    if (isMouseSequence(input)) {
      for (const event of parseWheelEvents(input)) onWheel.current(event);
      return;
    }
    if (logSearchInput) {
      if (key.escape) {
        setLogQuery("");
        setLogSearchInput(false);
      } else if (key.return) {
        setLogSearchInput(false);
        const matches = findMatches(pane.lines, logQuery);
        if (matches.length === 0) {
          setMessage(logQuery === "" ? undefined : "no match in the log");
          setLogQuery("");
        } else {
          setMatchPos(matches.length - 1);
          setLogScroll(scrollToLine(pane.lines.length, outputHeight, matches[matches.length - 1]));
        }
      } else if (key.backspace || key.delete) {
        setLogQuery((q) => q.slice(0, -1));
      } else if (input && !key.ctrl && !key.meta) {
        setLogQuery((q) => q + input);
      }
      return;
    }
    if (input === "?") {
      setLogSearchInput(true);
      setLogQuery("");
      return;
    }
    if (input === "w") return void setWrap((v) => !v);
    if (logQuery !== "" && input === "n") return void jumpToMatch(Math.max(0, matchIndex - 1));
    if (logQuery !== "" && input === "N") {
      return void jumpToMatch(Math.min(logMatches.length - 1, matchIndex + 1));
    }
    if (logQuery !== "" && key.escape) return void setLogQuery("");
    if (key.pageUp || input === "u") return void setLogScroll((s) => s + 10);
    if (key.pageDown || input === "d") return void setLogScroll((s) => Math.max(0, s - 10));
    if (input === "1") {
      setView("runs");
      setLogScroll(0);
      return;
    }
    if (input === "2") {
      setView("results");
      setLogScroll(0);
      return;
    }
    if (input === "q" || key.escape || (key.ctrl && input === "c")) return void exit();

    setMessage(undefined);
    if (key.upArrow || input === "k") {
      if (view === "runs") setRunsCursor(Math.max(0, runsIndex - 1));
      else setResultsCursor(Math.max(0, resultsIndex - 1));
      setLogScroll(0);
    }
    if (key.downArrow || input === "j") {
      if (view === "runs") setRunsCursor(Math.min(Math.max(0, runs.length - 1), runsIndex + 1));
      else setResultsCursor(Math.min(Math.max(0, recorded.length - 1), resultsIndex + 1));
      setLogScroll(0);
    }
    if (key.return && view === "runs") {
      setRunLog((v) => !v);
      setLogScroll(0);
    }
  });

  const { window: tail, above } = logWindow(pane.lines, outputHeight, logScroll);
  const table = runsTable(runs);

  return (
    <Box flexDirection="column" height={height}>
      <Text wrap="truncate">
        {name ? <Text bold>{name} </Text> : null}
        <Text bold={view === "runs"} color={view === "runs" ? "cyan" : "gray"} inverse={view === "runs"}>
          {" 1 runs "}
        </Text>{" "}
        <Text
          bold={view === "results"}
          color={view === "results" ? "cyan" : "gray"}
          inverse={view === "results"}
        >
          {" 2 results "}
        </Text>
        <Text dimColor> {runs.length} runs recorded</Text>
      </Text>
      <Box flexGrow={1}>
        <Box flexDirection="column" width="42%" borderStyle="round" paddingX={1} overflow="hidden">
          {view === "runs" ? (
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
                <Text key={runs[i].id} inverse={i === runsIndex} color={RUN_COLOR[runs[i].status]} wrap="truncate">
                  {row}
                </Text>
              ))}
            </>
          ) : (
            <>
              <Text bold color="cyan">
                RECORDED TESTS
              </Text>
              {recorded.length === 0 ? <Text dimColor>no recorded runs yet</Text> : null}
              {recorded.map((test, i) => {
                const g = STATUS_GLYPH[test.lastStatus] ?? { glyph: "·", color: "gray" };
                return (
                  <Text key={test.path} inverse={i === resultsIndex} wrap="truncate">
                    <Text color={g.color}>{g.glyph}</Text> {test.path}
                    <Text dimColor>
                      {" "}
                      {test.passes}✔ {test.fails}✘ of {test.occurrences}
                    </Text>
                  </Text>
                );
              })}
            </>
          )}
        </Box>
        <Box flexDirection="column" flexGrow={1} borderStyle="round" paddingX={1} overflow="hidden">
          <Text bold wrap="truncate">
            {pane.title}
            {above > 0 ? <Text color="magenta"> ↑{above} more</Text> : null}
            {logQuery !== "" || logSearchInput ? (
              <Text color="magenta">
                {" "}
                ?{logQuery}
                {logMatches.length > 0 ? ` ${matchIndex + 1}/${logMatches.length}` : ""}
              </Text>
            ) : null}
            {pane.note ? <Text dimColor> — {pane.note}</Text> : null}
          </Text>
          {tail.map((line, i) => (
            <Text
              key={i}
              wrap={wrap ? "wrap" : "truncate"}
              inverse={above + i === currentMatchLine}
              color={line.stream === "stderr" ? "yellow" : line.stream === "system" ? "cyan" : undefined}
              dimColor={line.stream === "system"}
            >
              {line.text || " "}
            </Text>
          ))}
        </Box>
      </Box>
      <Text dimColor>
        {logSearchInput
          ? "type to search the log · enter jump · esc cancel"
          : view === "runs"
            ? "↑/↓ select run · enter log/details · 1/2 view · ? log search · w wrap · u/d or mouse wheel scroll · q quit"
            : "↑/↓ select test · 1/2 view · ? log search · w wrap · u/d or mouse wheel scroll · q quit"}
        {message ? ` · ${message}` : ""}
      </Text>
    </Box>
  );
}

// Merged run logs for browsing, cached per run id.
function loadRunLog(history: RunHistory, run: RunRecord, cache: Map<string, OutputLine[]>): OutputLine[] {
  let lines = cache.get(run.id);
  if (!lines) {
    lines = logToLines(history.readRunLog(run), "(no log recorded)");
    cache.set(run.id, lines);
  }
  return lines;
}
