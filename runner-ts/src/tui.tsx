import React, { useEffect, useRef, useState } from "react";
import { Box, Text, useApp, useInput, useStdout } from "ink";
import type { OutputLine } from "./output.js";
import type { RunNode, Status } from "./runtree.js";
import type { ServiceInstance, ServiceStatus } from "./services.js";
import type { Session } from "./session.js";
import { failedLeafIds, logWindow, visibleNodes } from "./tui-model.js";
import { formatMs } from "./util.js";

const NODE_GLYPH: Record<Status, { glyph: string; color: string }> = {
  pending: { glyph: "·", color: "gray" },
  running: { glyph: "▶", color: "yellow" },
  passed: { glyph: "✔", color: "green" },
  failed: { glyph: "✘", color: "red" },
  skipped: { glyph: "↷", color: "gray" },
  aborted: { glyph: "■", color: "magenta" },
};

const SERVICE_GLYPH: Record<ServiceStatus, { glyph: string; color: string }> = {
  pending: { glyph: "·", color: "gray" },
  starting: { glyph: "◐", color: "yellow" },
  ready: { glyph: "●", color: "green" },
  stopping: { glyph: "◌", color: "yellow" },
  stopped: { glyph: "○", color: "gray" },
  failed: { glyph: "✘", color: "red" },
};

interface TestRow {
  kind: "test";
  node: RunNode;
}

interface ServiceRow {
  kind: "service";
  service: ServiceInstance;
}

type SelectableRow = TestRow | ServiceRow;

interface PaneContent {
  title: string;
  note?: string;
  lines: OutputLine[];
}

export function App({
  session,
  initialSelection = [],
}: {
  session: Session;
  initialSelection?: number[];
}): React.ReactElement {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const [, setTick] = useState(0);
  const [cursor, setCursor] = useState(0);
  const [selection, setSelection] = useState<Set<number>>(new Set(initialSelection));
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
  const [query, setQuery] = useState("");
  const [searchInput, setSearchInput] = useState(false);
  const [logScroll, setLogScroll] = useState(0);
  const [message, setMessage] = useState<string | undefined>();
  const [stopRequested, setStopRequested] = useState(false);
  // Logs of previous runs, loaded lazily per test path (null = no log found).
  const previousLogs = useRef(new Map<string, PaneContent | null>());
  const lastRecordId = useRef<string | undefined>(undefined);

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
  const rows: SelectableRow[] = visible.map((node) => ({ kind: "test", node }));
  const services = session.runner?.services ?? [];
  for (const service of services) rows.push({ kind: "service", service });
  const cursorIndex = Math.min(cursor, Math.max(0, rows.length - 1));
  const current: SelectableRow | undefined = rows[cursorIndex];

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
    setCursor(Math.max(0, Math.min(rows.length - 1, cursorIndex + delta)));
    setLogScroll(0);
  };

  useInput((input, key) => {
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

    setMessage(undefined);
    if (key.upArrow || input === "k") moveCursor(-1);
    if (key.downArrow || input === "j") moveCursor(1);
    if (key.pageUp || input === "u") setLogScroll((s) => s + 10);
    if (key.pageDown || input === "d") setLogScroll((s) => Math.max(0, s - 10));

    if (input === "/") {
      setSearchInput(true);
      setQuery("");
      return;
    }
    if (key.escape && query !== "") {
      setQuery("");
      return;
    }

    if ((key.leftArrow || input === "h" || key.rightArrow || input === "l") && current?.kind === "test") {
      const node = current.node;
      if (node.children.length > 0) {
        setCollapsed((old) => {
          const next = new Set(old);
          if (key.leftArrow || input === "h") next.add(node.id);
          else next.delete(node.id);
          return next;
        });
      }
    }

    if (input === " " && current?.kind === "test") {
      setSelection((old) => {
        const next = new Set(old);
        if (next.has(current.node.id)) next.delete(current.node.id);
        else next.add(current.node.id);
        return next;
      });
    }
    if (input === "a" || input === "A") {
      setSelection((old) => (old.size > 0 ? new Set() : new Set([session.tree.id])));
    }
    if ((input === "c" || input === "C") && current?.kind === "test" && current.node.children.length > 0) {
      const childIds = current.node.children.map((child) => child.id);
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
        void session.runSelected(selection);
      }
    }
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
    }
  });

  const height = (stdout?.rows ?? 30) - 2;
  const outputHeight = Math.max(5, height - 4);
  const pane = paneContent(current, session, previousLogs.current);
  const { window: tail, above } = logWindow(pane.lines, outputHeight, logScroll);

  return (
    <Box flexDirection="column" height={height}>
      <Box flexGrow={1}>
        <Box flexDirection="column" width="42%" borderStyle="round" paddingX={1} overflow="hidden">
          <Text bold color="cyan">
            TESTS
            {query !== "" ? <Text color="magenta"> /{query}</Text> : null}
          </Text>
          {visible.map((node) => {
            const row = rows.find((r) => r.kind === "test" && r.node === node) as TestRow;
            const isCursor = rows.indexOf(row) === cursorIndex;
            const g = NODE_GLYPH[node.status];
            const explicit = selection.has(node.id);
            const inherited = !explicit && isEffectivelySelected(node);
            const checkbox = explicit ? "[x]" : inherited ? "[~]" : "[ ]";
            const fold =
              node.children.length > 0 ? (collapsed.has(node.id) && query === "" ? "▸ " : "▾ ") : "";
            const duration =
              node.startedAt !== undefined && node.endedAt !== undefined
                ? formatMs(node.endedAt - node.startedAt)
                : undefined;
            const last =
              node.status === "pending" && duration === undefined
                ? session.history.latestFor(node.path)
                : undefined;
            return (
              <Text key={`n-${node.id}`} inverse={isCursor} wrap="truncate">
                <Text color={explicit || inherited ? "cyan" : "gray"}>{checkbox}</Text>{" "}
                {"  ".repeat(node.depth)}
                {fold}
                <Text color={g.color}>{g.glyph}</Text> {node.name}
                {duration ? <Text dimColor> {duration}</Text> : null}
                {last ? (
                  <Text dimColor>
                    {" "}
                    last {NODE_GLYPH[last.test.status].glyph}
                    {last.test.durationMs !== undefined ? ` ${formatMs(last.test.durationMs)}` : ""}
                  </Text>
                ) : null}
              </Text>
            );
          })}
          {services.length > 0 ? (
            <Text bold color="cyan">
              SERVICES
            </Text>
          ) : null}
          {services.map((service, i) => {
            const row = rows.find((r) => r.kind === "service" && r.service === service) as ServiceRow;
            const isCursor = rows.indexOf(row) === cursorIndex;
            const g = SERVICE_GLYPH[service.status];
            return (
              <Text key={`s-${i}`} inverse={isCursor} wrap="truncate">
                {"    "}
                <Text color={g.color}>{g.glyph}</Text> {service.name}
                <Text dimColor>
                  {" "}
                  {service.status} ({service.owner})
                </Text>
              </Text>
            );
          })}
        </Box>
        <Box flexDirection="column" flexGrow={1} borderStyle="round" paddingX={1} overflow="hidden">
          <Text bold wrap="truncate">
            {pane.title}
            {pane.note ? <Text dimColor> — {pane.note}</Text> : null}
            {above > 0 ? <Text color="magenta"> ↑{above} more</Text> : null}
          </Text>
          {tail.map((line, i) => (
            <Text
              key={i}
              wrap="truncate"
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
        {searchInput
          ? "type to search · enter keep · esc clear"
          : "space select · a all · c children · f failed · enter run · / search · ←/→ fold · u/d scroll · " +
            (session.running ? (stopRequested ? "q force stop" : "q stop") : "q quit")}
        {stopRequested && session.running ? " · stopping gracefully..." : ""}
      </Text>
    </Box>
  );
}

// The right pane shows the live log of the selection, or - when the test has
// not run in this session - the log of its most recent recorded run.
function paneContent(
  current: SelectableRow | undefined,
  session: Session,
  cache: Map<string, PaneContent | null>
): PaneContent {
  if (!current) return { title: "", lines: [] };
  if (current.kind === "service") {
    return { title: `service ${current.service.name}`, lines: current.service.output.lines };
  }
  const node = current.node;
  if (node.status !== "pending" || node.output.lines.length > 0) {
    const note =
      session.running && node.status === "pending" && session.runner?.isActive(node)
        ? "queued"
        : node.status;
    return { title: node.name, note, lines: node.output.lines };
  }
  if (session.running && session.runner?.isActive(node)) {
    return { title: node.name, note: "queued", lines: [] };
  }
  if (!cache.has(node.path)) {
    const latest = session.history.latestFor(node.path);
    const text = latest ? session.history.readLog(latest.run, latest.test) : undefined;
    cache.set(
      node.path,
      latest
        ? {
            title: node.name,
            note: `previous run ${latest.run.startedAt} (${latest.test.status})`,
            lines: (text ?? "")
              .split("\n")
              .filter((_, i, arr) => i < arr.length - 1 || arr[i] !== "")
              .map((line) => ({
                text: line.startsWith("# ") ? line.slice(2) : line,
                stream: line.startsWith("# ") ? ("system" as const) : ("stdout" as const),
              })),
          }
        : null
    );
  }
  const previous = cache.get(node.path);
  if (previous) return previous;
  return { title: node.name, note: "not run yet", lines: [] };
}
