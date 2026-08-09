// The log pane: a scrolling window over recorded output with wrap, search
// and follow - the part of the old TUI worth keeping, as a component the
// run page and the test page share.
import React, { useMemo, useState } from "react";
import { Box, Text, useInput } from "ink";
import { useEscape, useTextInput } from "./interaction.js";
import { findMatches, logWindow, scrollToLine, type OutputLine } from "./model.js";
import { isMouseSequence, parseWheelEvents } from "./mouse.js";
import { useShortcuts } from "./statusbar.js";

const STREAM_COLOR: Record<OutputLine["stream"], string | undefined> = {
  stdout: undefined,
  stderr: "red",
  system: "cyan",
};

function wrapLines(lines: readonly OutputLine[], width: number): OutputLine[] {
  const out: OutputLine[] = [];
  for (const line of lines) {
    if (line.text.length <= width) {
      out.push(line);
      continue;
    }
    for (let at = 0; at < line.text.length; at += width) {
      out.push({ text: line.text.slice(at, at + width), stream: line.stream });
    }
  }
  return out;
}

export function LogPane({
  id,
  lines,
  height,
  width,
  focused,
}: {
  id: string;
  lines: readonly OutputLine[];
  height: number;
  width: number;
  focused: boolean;
}): React.ReactElement {
  const [scroll, setScroll] = useState(0);
  const [wrap, setWrap] = useState(false);
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState("");
  const [matchPos, setMatchPos] = useState(0);

  const display = useMemo(
    () => (wrap ? wrapLines(lines, Math.max(10, width)) : lines.slice()),
    [lines, wrap, width],
  );
  const matches = useMemo(() => findMatches(display, query), [display, query]);

  const jumpTo = (position: number): void => {
    const line = matches[position];
    if (line !== undefined) setScroll(scrollToLine(display.length, height, line));
  };

  // Escape while searching closes the search instead of leaving the page,
  // and an open search suppresses the global single-letter keys.
  useEscape(`${id}-search`, focused && searching, () => {
    setSearching(false);
    setQuery("");
  });
  useTextInput(id, focused && searching);

  useInput(
    (input, key) => {
      if (isMouseSequence(input)) {
        for (const wheel of parseWheelEvents(input)) {
          setScroll((s) =>
            Math.max(0, Math.min(display.length, s + (wheel.direction === "up" ? 3 : -3))),
          );
        }
        return;
      }
      if (searching) {
        if (key.return) {
          setSearching(false);
          setMatchPos(0);
          const found = findMatches(display, query);
          if (found[0] !== undefined) setScroll(scrollToLine(display.length, height, found[0]));
        } else if (key.escape) {
          // handled by useEscape; swallow so nothing else sees it
        } else if (key.backspace || key.delete) setQuery((q) => q.slice(0, -1));
        else if (input && !key.ctrl && !key.meta) setQuery((q) => q + input);
        return;
      }
      if (key.upArrow) setScroll((s) => Math.min(display.length, s + 1));
      else if (key.downArrow) setScroll((s) => Math.max(0, s - 1));
      else if (key.pageUp) setScroll((s) => Math.min(display.length, s + height));
      else if (key.pageDown) setScroll((s) => Math.max(0, s - height));
      else if (input === "g") setScroll(Math.max(0, display.length - height));
      else if (input === "G") setScroll(0);
      else if (input === "w") setWrap((value) => !value);
      else if (input === "/") setSearching(true);
      else if (input === "n" && matches.length > 0) {
        const next = (matchPos + 1) % matches.length;
        setMatchPos(next);
        jumpTo(next);
      } else if (input === "N" && matches.length > 0) {
        const previous = (matchPos - 1 + matches.length) % matches.length;
        setMatchPos(previous);
        jumpTo(previous);
      }
    },
    { isActive: focused },
  );

  useShortcuts(
    id,
    "Log",
    [
      { keys: "↑↓ pgup/pgdn", label: "scroll" },
      { keys: "w", label: "wrap" },
      { keys: "/", label: "search" },
      { keys: "n/N", label: "next/prev match" },
    ],
    focused,
  );

  const { window, above } = logWindow(display, height, scroll);
  return (
    <Box flexDirection="column" width={width}>
      {searching && (
        <Text>
          <Text color="cyan">search: </Text>
          {query}
          <Text inverse> </Text>
        </Text>
      )}
      {window.length === 0 ? (
        <Text dimColor>no output recorded</Text>
      ) : (
        window.map((line, index) => {
          const matched = query !== "" && line.text.toLowerCase().includes(query.toLowerCase());
          return (
            <Text
              key={above + index}
              color={STREAM_COLOR[line.stream]}
              dimColor={line.stream === "system"}
              backgroundColor={matched ? "yellow" : undefined}
            >
              {(wrap ? line.text : line.text.slice(0, width)) || " "}
            </Text>
          );
        })
      )}
      {scroll > 0 && (
        <Text dimColor>
          ↓ {scroll} more below{matches.length > 0 ? ` · ${matches.length} matches` : ""}
        </Text>
      )}
    </Box>
  );
}
