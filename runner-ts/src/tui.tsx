import React, { useEffect, useRef, useState } from "react";
import { Box, Text, useApp, useInput, useStdout } from "ink";
import type { OutputLine } from "./output.js";
import type { RunNode, Status } from "./runtree.js";
import { walk } from "./runtree.js";
import type { ServiceInstance, ServiceStatus } from "./services.js";
import type { Session } from "./session.js";
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

interface HeaderRow {
  kind: "header";
  label: string;
}

type Row = TestRow | ServiceRow | HeaderRow;

interface PaneContent {
  title: string;
  note?: string;
  lines: OutputLine[];
}

export function App({ session }: { session: Session }): React.ReactElement {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const [, setTick] = useState(0);
  const [cursor, setCursor] = useState(0);
  const [selection, setSelection] = useState<Set<number>>(new Set());
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

  const rows: Row[] = [{ kind: "header", label: "TESTS" }];
  walk(session.tree, (node) => rows.push({ kind: "test", node }));
  const services = session.runner?.services ?? [];
  if (services.length > 0) {
    rows.push({ kind: "header", label: "SERVICES" });
    for (const service of services) rows.push({ kind: "service", service });
  }
  const selectable = rows.filter((row): row is TestRow | ServiceRow => row.kind !== "header");
  const cursorIndex = Math.min(cursor, selectable.length - 1);
  const current = selectable[cursorIndex];

  const isEffectivelySelected = (node: RunNode): boolean => {
    for (let n: RunNode | undefined = node; n; n = n.parent) {
      if (selection.has(n.id)) return true;
    }
    return false;
  };

  const leaves: RunNode[] = [];
  walk(session.tree, (node) => {
    if (node.children.length === 0) leaves.push(node);
  });
  const selectedCount = leaves.filter(isEffectivelySelected).length;
  const runningCount = leaves.filter((l) => l.status === "running").length;
  const queuedCount = session.running
    ? leaves.filter((l) => session.runner?.isActive(l) && l.status === "pending").length
    : 0;
  const passedCount = leaves.filter((l) => l.status === "passed").length;
  const failedCount = leaves.filter((l) => l.status === "failed" || l.status === "aborted").length;

  useInput((input, key) => {
    setMessage(undefined);
    if (key.upArrow || input === "k") setCursor(Math.max(0, cursorIndex - 1));
    if (key.downArrow || input === "j") setCursor(Math.min(selectable.length - 1, cursorIndex + 1));

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
    if (key.return) {
      if (session.running) {
        setMessage("a run is already in progress");
      } else if (selectedCount === 0) {
        setMessage("no tests selected — space selects, a selects all");
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

  const pane = paneContent(current, session, previousLogs.current);
  const height = (stdout?.rows ?? 30) - 2;
  const outputHeight = Math.max(5, height - 4);
  const tail = pane.lines.slice(-outputHeight);

  return (
    <Box flexDirection="column" height={height}>
      <Box flexGrow={1}>
        <Box flexDirection="column" width="42%" borderStyle="round" paddingX={1} overflow="hidden">
          {rows.map((row) => {
            if (row.kind === "header") {
              return (
                <Text key={`h-${row.label}`} bold color="cyan">
                  {row.label}
                </Text>
              );
            }
            const isCursor = selectable.indexOf(row) === cursorIndex;
            if (row.kind === "service") {
              const g = SERVICE_GLYPH[row.service.status];
              return (
                <Text key={`s-${row.service.name}-${row.service.owner}`} inverse={isCursor} wrap="truncate">
                  {"    "}
                  <Text color={g.color}>{g.glyph}</Text> {row.service.name}
                  <Text dimColor>
                    {" "}
                    {row.service.status} ({row.service.owner})
                  </Text>
                </Text>
              );
            }
            const node = row.node;
            const g = NODE_GLYPH[node.status];
            const explicit = selection.has(node.id);
            const inherited = !explicit && isEffectivelySelected(node);
            const checkbox = explicit ? "[x]" : inherited ? "[~]" : "[ ]";
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
        </Box>
        <Box flexDirection="column" flexGrow={1} borderStyle="round" paddingX={1} overflow="hidden">
          <Text bold wrap="truncate">
            {pane.title}
            {pane.note ? <Text dimColor> — {pane.note}</Text> : null}
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
        space select · a all · c children · enter run ·{" "}
        {session.running ? (stopRequested ? "q force stop" : "q stop") : "q quit"}
        {stopRequested && session.running ? " · stopping gracefully..." : ""}
      </Text>
    </Box>
  );
}

// The right pane shows the live log of the selection, or - when the test has
// not run in this session - the log of its most recent recorded run.
function paneContent(
  current: TestRow | ServiceRow | undefined,
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
