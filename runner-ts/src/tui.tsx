import React, { useEffect, useState } from "react";
import { Box, Text, useApp, useInput, useStdout } from "ink";
import type { Runner } from "./executor.js";
import type { OutputBuffer } from "./output.js";
import type { RunNode, Status } from "./runtree.js";
import type { ServiceInstance, ServiceStatus } from "./services.js";
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

interface Item {
  key: string;
  label: string;
  depth: number;
  glyph: { glyph: string; color: string };
  suffix?: string;
  output: OutputBuffer;
  header?: never;
}

interface Header {
  key: string;
  header: string;
}

type Row = Item | Header;

function collectRows(runner: Runner): Row[] {
  const rows: Row[] = [{ key: "h-tests", header: "TESTS" }];
  const visit = (node: RunNode) => {
    const duration =
      node.startedAt && node.endedAt ? formatMs(node.endedAt - node.startedAt) : undefined;
    rows.push({
      key: `n${node.id}`,
      label: node.name,
      depth: node.depth,
      glyph: NODE_GLYPH[node.status],
      suffix: duration,
      output: node.output,
    });
    node.children.forEach(visit);
  };
  visit(runner.root);
  if (runner.services.length > 0) {
    rows.push({ key: "h-services", header: "SERVICES" });
    runner.services.forEach((service, i) => {
      rows.push({
        key: `s${i}`,
        label: `${service.name} (${service.owner})`,
        depth: 0,
        glyph: SERVICE_GLYPH[service.status],
        suffix: service.status,
        output: service.output,
      });
    });
  }
  return rows;
}

export function App({ runner }: { runner: Runner }): React.ReactElement {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const [, setTick] = useState(0);
  const [selected, setSelected] = useState(0);
  const [stopRequested, setStopRequested] = useState(false);

  useEffect(() => {
    const bump = () => setTick((t) => t + 1);
    runner.on("update", bump);
    const timer = setInterval(bump, 200);
    return () => {
      runner.off("update", bump);
      clearInterval(timer);
    };
  }, [runner]);

  const rows = collectRows(runner);
  const items = rows.filter((r): r is Item => !("header" in r && r.header));
  const current = items[Math.min(selected, items.length - 1)];

  useInput((input, key) => {
    if (key.upArrow || input === "k") setSelected((s) => Math.max(0, s - 1));
    if (key.downArrow || input === "j") setSelected((s) => Math.min(items.length - 1, s + 1));
    if (input === "q" || (key.ctrl && input === "c")) {
      if (runner.finished) {
        exit();
      } else if (!stopRequested) {
        setStopRequested(true);
        runner.requestStop();
      } else {
        runner.forceStop();
        exit();
      }
    }
  });

  const height = (stdout?.rows ?? 30) - 2;
  const outputHeight = Math.max(5, height - 2);
  const tail = current?.output.lines.slice(-outputHeight) ?? [];

  return (
    <Box flexDirection="column" height={height}>
      <Box flexGrow={1}>
        <Box flexDirection="column" width="40%" borderStyle="round" paddingX={1} overflow="hidden">
          {rows.map((row) =>
            "header" in row && row.header ? (
              <Text key={row.key} bold color="cyan">
                {row.header}
              </Text>
            ) : (
              (() => {
                const item = row as Item;
                const isSelected = items.indexOf(item) === Math.min(selected, items.length - 1);
                return (
                  <Text key={item.key} inverse={isSelected} wrap="truncate">
                    {"  ".repeat(item.depth)}
                    <Text color={item.glyph.color}>{item.glyph.glyph}</Text> {item.label}
                    {item.suffix ? <Text dimColor> {item.suffix}</Text> : null}
                  </Text>
                );
              })()
            )
          )}
        </Box>
        <Box flexDirection="column" flexGrow={1} borderStyle="round" paddingX={1} overflow="hidden">
          <Text bold wrap="truncate">
            {current?.label ?? ""}
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
      <Text dimColor>
        ↑/↓ select · q {runner.finished ? "quit" : stopRequested ? "force stop" : "stop"}
        {stopRequested && !runner.finished ? " · stopping gracefully..." : ""}
      </Text>
    </Box>
  );
}
