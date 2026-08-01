import React, { useEffect, useRef, useState } from "react";
import { Box, Text, useApp, useInput, useStdout } from "ink";
import type { OutputLine } from "../output.js";
import type { RunNode } from "../runtree.js";
import type { Session } from "../session.js";
import {
  collectServiceDefs,
  failedLeafIds,
  findMatches,
  logWindow,
  runningFocus,
  scrollToLine,
  serviceRows,
  visibleNodes,
  type PaneContent,
} from "./model.js";
import { isMouseSequence, parseWheelEvents, type WheelEvent } from "./mouse.js";
import { HistoryPane, historyPaneContent } from "./history-view.js";
import { ServicesPane, servicePaneContent } from "./services-view.js";
import { TestsPane, testPaneContent, TEST_TABS, type TestTab } from "./tests-view.js";

export type TuiView = "tests" | "history" | "services";

const VIEWS: { view: TuiView; label: string }[] = [
  { view: "tests", label: "1 tests" },
  { view: "history", label: "2 history" },
  { view: "services", label: "3 services" },
];

export function App({
  session,
  initialSelection = [],
  initialView = "tests",
}: {
  session: Session;
  initialSelection?: number[];
  initialView?: TuiView;
}): React.ReactElement {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const [, setTick] = useState(0);
  const [view, setView] = useState<TuiView>(initialView);
  const [message, setMessage] = useState<string | undefined>();
  const [stopRequested, setStopRequested] = useState(false);
  // Tests view: cursor, selection, folding, tree search and the detail tab.
  const [cursor, setCursor] = useState(0);
  const [selection, setSelection] = useState<Set<number>>(new Set(initialSelection));
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
  const [query, setQuery] = useState("");
  const [searchInput, setSearchInput] = useState(false);
  const [testTab, setTestTab] = useState<TestTab>("log");
  // History view: pick a recorded run, view its detail or merged log.
  const [historyCursor, setHistoryCursor] = useState(0);
  const [historyLog, setHistoryLog] = useState(false);
  const runLogs = useRef(new Map<string, OutputLine[]>());
  // Services view.
  const [servicesCursor, setServicesCursor] = useState(0);
  // Detail pane: scroll, wrap toggle and in-log search with match navigation.
  const [logScroll, setLogScroll] = useState(0);
  const [wrap, setWrap] = useState(false);
  const [logSearchInput, setLogSearchInput] = useState(false);
  const [logQuery, setLogQuery] = useState("");
  const [matchPos, setMatchPos] = useState(0);
  // Logs of previous runs, loaded lazily per test path (null = no log found).
  const previousLogs = useRef(new Map<string, PaneContent | null>());
  const lastRecordId = useRef<string | undefined>(undefined);
  // Auto-follow: while a run is in progress the cursor tracks the running
  // test, until the user navigates manually. Re-armed on every new run.
  const manualNav = useRef(false);
  const wasRunning = useRef(false);

  useEffect(() => {
    const bump = () => {
      if (session.lastRecord?.id !== lastRecordId.current) {
        lastRecordId.current = session.lastRecord?.id;
        previousLogs.current.clear();
      }
      setTick((t) => t + 1);
    };
    session.on("update", bump);
    const timer = setInterval(bump, 200);
    return () => {
      session.off("update", bump);
      clearInterval(timer);
    };
  }, [session]);

  const visible = visibleNodes(session.tree, collapsed, query);

  if (session.running && !wasRunning.current) manualNav.current = false;
  wasRunning.current = session.running;
  let cursorIndex = Math.min(cursor, Math.max(0, visible.length - 1));
  if (view === "tests" && session.running && !manualNav.current) {
    const focus = runningFocus(session.tree);
    const focusIndex = focus ? visible.indexOf(focus) : -1;
    if (focusIndex >= 0) cursorIndex = focusIndex;
  }
  const currentNode: RunNode | undefined = visible[cursorIndex];

  const isEffectivelySelected = (node: RunNode): boolean => {
    for (let n: RunNode | undefined = node; n; n = n.parent) {
      if (selection.has(n.id)) return true;
    }
    return false;
  };

  const leaves: RunNode[] = [];
  const collectLeaves = (node: RunNode): void => {
    if (node.children.length === 0) leaves.push(node);
    node.children.forEach(collectLeaves);
  };
  collectLeaves(session.tree);
  const selectedCount = leaves.filter(isEffectivelySelected).length;
  const runningCount = leaves.filter((l) => l.status === "running").length;
  const queuedCount = session.running
    ? leaves.filter((l) => session.runner?.isActive(l) && l.status === "pending").length
    : 0;
  const passedCount = leaves.filter((l) => l.status === "passed").length;
  const failedCount = leaves.filter((l) => l.status === "failed" || l.status === "aborted").length;

  const moveCursor = (delta: number): void => {
    manualNav.current = true;
    setCursor(Math.max(0, Math.min(visible.length - 1, cursorIndex + delta)));
    setLogScroll(0);
  };

  const height = (stdout?.rows ?? 30) - 2;
  const outputHeight = Math.max(5, height - 5);

  const historyRuns = session.history.runs;
  const historyIndex = Math.min(historyCursor, Math.max(0, historyRuns.length - 1));
  const svcRows = serviceRows(
    collectServiceDefs(session.doc, session.tree),
    session.runner?.services ?? []
  );
  const servicesIndex = Math.min(servicesCursor, Math.max(0, svcRows.length - 1));

  const pane: PaneContent =
    view === "history"
      ? historyPaneContent(session, historyRuns[historyIndex], historyLog, runLogs.current)
      : view === "services"
        ? servicePaneContent(svcRows[servicesIndex], session)
        : testPaneContent(currentNode, testTab, session, previousLogs.current);
  const logMatches = findMatches(pane.lines, logQuery);
  const matchIndex = Math.min(matchPos, Math.max(0, logMatches.length - 1));
  const currentMatchLine = logMatches.length > 0 ? logMatches[matchIndex] : undefined;

  const jumpToMatch = (position: number): void => {
    setMatchPos(position);
    const line = logMatches[position];
    if (line !== undefined) setLogScroll(scrollToLine(pane.lines.length, outputHeight, line));
  };

  const switchView = (next: TuiView): void => {
    setView(next);
    setLogScroll(0);
    setMessage(undefined);
  };

  // Mouse wheel: scrolls the log/detail pane (up scrolls back in the log,
  // down towards the tail, which it follows again once reached).
  const onWheel = useRef<(event: WheelEvent) => void>(() => {});
  onWheel.current = (event) => {
    setLogScroll((s) => (event.direction === "up" ? s + 3 : Math.max(0, s - 3)));
  };
  useInput((input, key) => {
    // Mouse reports arrive through stdin like keys; scroll on wheel events
    // and never treat any mouse sequence as a keypress.
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
    if (searchInput) {
      if (key.escape) {
        setQuery("");
        setSearchInput(false);
      } else if (key.return) {
        setSearchInput(false);
      } else if (key.backspace || key.delete) {
        setQuery((q) => q.slice(0, -1));
      } else if (input && !key.ctrl && !key.meta) {
        setQuery((q) => q + input);
      }
      setCursor(0);
      return;
    }
    if (input === "?") {
      setLogSearchInput(true);
      setLogQuery("");
      return;
    }
    if (input === "w") {
      setWrap((v) => !v);
      return;
    }
    if (logQuery !== "" && input === "n") {
      jumpToMatch(Math.max(0, matchIndex - 1));
      return;
    }
    if (logQuery !== "" && input === "N") {
      jumpToMatch(Math.min(logMatches.length - 1, matchIndex + 1));
      return;
    }
    if (logQuery !== "" && key.escape) {
      setLogQuery("");
      return;
    }
    if (key.pageUp || input === "u") {
      setLogScroll((s) => s + 10);
      return;
    }
    if (key.pageDown || input === "d") {
      setLogScroll((s) => Math.max(0, s - 10));
      return;
    }
    if (input === "1") return switchView("tests");
    if (input === "2" || input === "H") return switchView(view === "history" ? "tests" : "history");
    if (input === "3") return switchView(view === "services" ? "tests" : "services");
    if (input === "q" || (key.ctrl && input === "c")) {
      if (!session.running) {
        exit();
      } else if (!stopRequested) {
        setStopRequested(true);
        session.runner?.requestStop();
      } else {
        session.runner?.forceStop();
        exit();
      }
      return;
    }

    if (view === "history") {
      if (key.upArrow || input === "k") {
        setHistoryCursor(Math.max(0, historyIndex - 1));
        setLogScroll(0);
      }
      if (key.downArrow || input === "j") {
        setHistoryCursor(Math.min(Math.max(0, historyRuns.length - 1), historyIndex + 1));
        setLogScroll(0);
      }
      if (key.return) {
        setHistoryLog((v) => !v);
        setLogScroll(0);
      }
      if (key.escape) switchView("tests");
      return;
    }

    if (view === "services") {
      if (key.upArrow || input === "k") {
        setServicesCursor(Math.max(0, servicesIndex - 1));
        setLogScroll(0);
      }
      if (key.downArrow || input === "j") {
        setServicesCursor(Math.min(Math.max(0, svcRows.length - 1), servicesIndex + 1));
        setLogScroll(0);
      }
      if (input === "r") {
        const service = svcRows[servicesIndex]?.instance;
        if (!service) {
          setMessage("service is not running — it starts with the tests that need it");
        } else if (service.status === "starting" || service.status === "stopping") {
          setMessage(`service ${service.name} is busy`);
        } else {
          setMessage(`restarting service ${service.name}`);
          void service.restart();
        }
      }
      if (key.escape) switchView("tests");
      return;
    }

    setMessage(undefined);
    if (key.upArrow || input === "k") moveCursor(-1);
    if (key.downArrow || input === "j") moveCursor(1);
    if (key.tab) {
      const delta = key.shift ? TEST_TABS.length - 1 : 1;
      setTestTab(TEST_TABS[(TEST_TABS.indexOf(testTab) + delta) % TEST_TABS.length]);
      setLogScroll(0);
      return;
    }

    if (input === "/") {
      setSearchInput(true);
      setQuery("");
      return;
    }
    if (key.escape && query !== "") {
      setQuery("");
      return;
    }

    if ((key.leftArrow || input === "h" || key.rightArrow || input === "l") && currentNode) {
      if (currentNode.children.length > 0) {
        setCollapsed((old) => {
          const next = new Set(old);
          if (key.leftArrow || input === "h") next.add(currentNode.id);
          else next.delete(currentNode.id);
          return next;
        });
      }
    }

    if (input === " " && currentNode) {
      setSelection((old) => {
        const next = new Set(old);
        if (next.has(currentNode.id)) next.delete(currentNode.id);
        else next.add(currentNode.id);
        return next;
      });
    }
    if (input === "a" || input === "A") {
      setSelection((old) => (old.size > 0 ? new Set() : new Set([session.tree.id])));
    }
    if ((input === "c" || input === "C") && currentNode && currentNode.children.length > 0) {
      const childIds = currentNode.children.map((child) => child.id);
      setSelection((old) => {
        const next = new Set(old);
        const allSelected = childIds.every((id) => next.has(id));
        for (const id of childIds) {
          if (allSelected) next.delete(id);
          else next.add(id);
        }
        return next;
      });
    }
    if (input === "f" || input === "F") {
      const failed = failedLeafIds(session.tree, session.history);
      if (failed.length === 0) {
        setMessage("no failed tests to select");
      } else {
        setSelection(new Set(failed));
        setMessage(`selected ${failed.length} failed test${failed.length === 1 ? "" : "s"}`);
      }
    }
    if (key.return) {
      if (session.running) {
        setMessage("a run is already in progress");
      } else if (selectedCount === 0) {
        setMessage("no tests selected — space selects, a selects all, f selects failed");
      } else {
        setStopRequested(false);
        setTestTab("log");
        void session.runSelected(selection);
      }
    }
  });

  const { window: tail, above } = logWindow(pane.lines, outputHeight, logScroll);

  const keysHelp = logSearchInput
    ? "type to search the log · enter jump · esc cancel"
    : searchInput
      ? "type to search · enter keep · esc clear"
      : view === "history"
        ? "↑/↓ select run · enter log/details · ? log search · w wrap · u/d scroll · esc back · q quit"
        : view === "services"
          ? "↑/↓ select service · r restart · ? log search · w wrap · u/d scroll · esc back · q quit"
          : "space select · a all · c children · f failed · enter run · tab info/log/history · / tree · ? log · w wrap · ←/→ fold · u/d scroll · " +
            (session.running ? (stopRequested ? "q force stop" : "q stop") : "q quit");

  return (
    <Box flexDirection="column" height={height}>
      <Text wrap="truncate">
        {session.doc.name ? <Text bold>{session.doc.name} </Text> : null}
        {VIEWS.map(({ view: v, label }) => (
          <Text key={v}>
            {" "}
            <Text
              bold={v === view}
              color={v === view ? "cyan" : "gray"}
              inverse={v === view}
            >{` ${label} `}</Text>
          </Text>
        ))}
        {session.running ? <Text color="yellow"> running…</Text> : null}
      </Text>
      <Box flexGrow={1}>
        <Box flexDirection="column" width="42%" borderStyle="round" paddingX={1} overflow="hidden">
          {view === "history" ? <HistoryPane runs={historyRuns} index={historyIndex} /> : null}
          {view === "services" ? <ServicesPane rows={svcRows} index={servicesIndex} /> : null}
          {view === "tests" ? (
            <TestsPane
              session={session}
              visible={visible}
              cursorNode={currentNode}
              selection={selection}
              collapsed={collapsed}
              query={query}
            />
          ) : null}
        </Box>
        <Box flexDirection="column" flexGrow={1} borderStyle="round" paddingX={1} overflow="hidden">
          <Text bold wrap="truncate">
            {pane.title}
            {view === "tests" && currentNode ? (
              <Text>
                {" "}
                {TEST_TABS.map((tab) => (
                  <Text key={tab} bold={tab === testTab} color={tab === testTab ? "cyan" : "gray"}>
                    {" "}
                    {tab === testTab ? `[${tab}]` : tab}
                  </Text>
                ))}
              </Text>
            ) : null}
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
      <Text>
        <Text color="cyan">{selectedCount} selected</Text>
        {" · "}
        <Text color="yellow">{runningCount} running</Text>
        {" · "}
        <Text dimColor>{queuedCount} queued</Text>
        {" · "}
        <Text color="green">{passedCount} passed</Text>
        {" · "}
        <Text color="red">{failedCount} failed</Text>
        {message ? <Text color="magenta"> · {message}</Text> : null}
      </Text>
      <Text dimColor>
        {keysHelp}
        {stopRequested && session.running ? " · stopping gracefully..." : ""}
      </Text>
    </Box>
  );
}
