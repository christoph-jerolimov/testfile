import React from "react";
import { Text } from "ink";
import type { RunNode, Status } from "../runtree.js";
import type { Session } from "../session.js";
import { formatMs } from "../util.js";
import { buildInfoLines, testHistoryLines, type PaneContent } from "./model.js";

export const NODE_GLYPH: Record<Status, { glyph: string; color: string }> = {
  pending: { glyph: "·", color: "gray" },
  running: { glyph: "▶", color: "yellow" },
  passed: { glyph: "✔", color: "green" },
  failed: { glyph: "✘", color: "red" },
  skipped: { glyph: "↷", color: "gray" },
  aborted: { glyph: "■", color: "magenta" },
};

// The tabs of the detail pane when the cursor is on a test.
export type TestTab = "info" | "log" | "history";
export const TEST_TABS: TestTab[] = ["info", "log", "history"];

export function TestsPane({
  session,
  visible,
  cursorNode,
  selection,
  collapsed,
  query,
}: {
  session: Session;
  visible: RunNode[];
  cursorNode?: RunNode;
  selection: Set<number>;
  collapsed: Set<number>;
  query: string;
}): React.ReactElement {
  const isEffectivelySelected = (node: RunNode): boolean => {
    for (let n: RunNode | undefined = node; n; n = n.parent) {
      if (selection.has(n.id)) return true;
    }
    return false;
  };
  return (
    <>
      <Text bold color="cyan">
        TESTS
        {query !== "" ? <Text color="magenta"> /{query}</Text> : null}
      </Text>
      {visible.map((node) => {
        const g = NODE_GLYPH[node.status];
        const explicit = selection.has(node.id);
        const inherited = !explicit && isEffectivelySelected(node);
        const checkbox = explicit ? "[x]" : inherited ? "[~]" : "[ ]";
        const fold =
          node.children.length > 0 ? (collapsed.has(node.id) && query === "" ? "▸ " : "▾ ") : "";
        const duration =
          node.status === "running" && node.startedAt !== undefined
            ? formatMs(Date.now() - node.startedAt)
            : node.startedAt !== undefined && node.endedAt !== undefined
              ? formatMs(node.endedAt - node.startedAt)
              : undefined;
        const last =
          node.status === "pending" && duration === undefined
            ? session.history.latestFor(node.path)
            : undefined;
        return (
          <Text key={`n-${node.id}`} inverse={node === cursorNode} wrap="truncate">
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
    </>
  );
}

// The detail pane for a test, depending on the active tab. The log tab shows
// the live log of the selection, or - when the test has not run in this
// session - the log of its most recent recorded run.
export function testPaneContent(
  node: RunNode | undefined,
  tab: TestTab,
  session: Session,
  cache: Map<string, PaneContent | null>
): PaneContent {
  if (!node) return { title: "", lines: [] };
  if (tab === "info") {
    return { title: node.name, note: "info", lines: buildInfoLines(node, session.doc, session.history) };
  }
  if (tab === "history") {
    return { title: node.name, note: "history", lines: testHistoryLines(node.path, session.history) };
  }
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
