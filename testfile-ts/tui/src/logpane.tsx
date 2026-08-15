// The log pane: recorded output with a visible cursor line, wrap, search
// and selection - shared by the run page, the test page and the detail
// tabs. The view starts at the top and scrolls with the cursor, so the
// first arrow press always visibly moves something.
//
// Selection: shift+↑/↓ grows a selection from the cursor; ctrl-c copies it
// to the terminal's clipboard via OSC 52 and clears it. Without a
// selection ctrl-c stays what it always is - quit.
import React, { useEffect, useMemo, useState } from "react";
import { Box, Text, useInput, useStdout } from "ink";
import { useCtrlC, useEscape, useTextInput } from "./interaction.js";
import { findMatches, type OutputLine } from "./model.js";
import { isMouseSequence, parseWheelEvents } from "./mouse.js";
import { useShortcuts } from "./statusbar.js";
import { useViewState } from "./view-state.js";

const STREAM_COLOR: Record<OutputLine["stream"], string | undefined> = {
  stdout: undefined,
  stderr: "red",
  system: "cyan",
};

// How far ←/→ shift the view when wrapping is off.
const HORIZONTAL_STEP = 10;

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

// Writes the text into the terminal's clipboard (OSC 52); terminals that
// do not support it ignore the sequence.
function copyToClipboard(stream: NodeJS.WriteStream | undefined, text: string): void {
  const payload = Buffer.from(text, "utf8").toString("base64");
  (stream ?? process.stdout).write(
    `${String.fromCharCode(27)}]52;c;${payload}${String.fromCharCode(7)}`,
  );
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
  const [cursor, setCursor] = useViewState(`${id}:cursor`, 0);
  const [scroll, setScroll] = useViewState(`${id}:scroll`, 0);
  const [wrap, setWrap] = useState(false);
  const [column, setColumn] = useState(0);
  // The other end of a selection; undefined means nothing is selected.
  const [anchor, setAnchor] = useState<number | undefined>();
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState("");
  const [matchPos, setMatchPos] = useState(0);
  const [copied, setCopied] = useState(0);
  const { stdout } = useStdout();

  const display = useMemo(
    () => (wrap ? wrapLines(lines, Math.max(10, width)) : lines.slice()),
    [lines, wrap, width],
  );
  const matches = useMemo(() => findMatches(display, query), [display, query]);

  // The cursor follows the data; the window follows the cursor.
  const line = Math.min(cursor, Math.max(0, display.length - 1));
  const body = Math.max(1, height - 2);
  const from = Math.min(Math.max(0, display.length - body), Math.max(0, Math.min(scroll, line)));
  const top = line >= from + body ? line - body + 1 : from;
  useEffect(() => {
    if (top !== scroll) setScroll(top);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [top]);

  const move = (to: number, selecting: boolean): void => {
    const next = Math.max(0, Math.min(Math.max(0, display.length - 1), to));
    if (selecting) {
      if (anchor === undefined) setAnchor(line);
    } else setAnchor(undefined);
    setCursor(next);
  };

  const selection: [number, number] | undefined =
    anchor === undefined ? undefined : [Math.min(anchor, line), Math.max(anchor, line)];

  // Escape drops the selection first, then an open search, then the page.
  useEscape(`${id}-selection`, focused && selection !== undefined, () => setAnchor(undefined));
  useEscape(`${id}-search`, focused && searching, () => {
    setSearching(false);
    setQuery("");
  });
  useTextInput(id, focused && searching);
  useCtrlC(id, focused && selection !== undefined, () => {
    if (!selection) return;
    const text = display
      .slice(selection[0], selection[1] + 1)
      .map((entry) => entry.text)
      .join("\n");
    copyToClipboard(stdout, text);
    setCopied(selection[1] - selection[0] + 1);
    setAnchor(undefined);
  });

  useInput(
    (input, key) => {
      if (isMouseSequence(input)) {
        for (const wheel of parseWheelEvents(input))
          move(line + (wheel.direction === "up" ? -3 : 3), false);
        return;
      }
      if (searching) {
        if (key.return) {
          setSearching(false);
          setMatchPos(0);
          const found = findMatches(display, query);
          if (found[0] !== undefined) move(found[0], false);
        } else if (key.escape) {
          // handled by useEscape; swallow so nothing else sees it
        } else if (key.backspace || key.delete) setQuery((q) => q.slice(0, -1));
        else if (input && !key.ctrl && !key.meta) setQuery((q) => q + input);
        return;
      }
      setCopied(0);
      if (key.upArrow) move(line - 1, key.shift);
      else if (key.downArrow) move(line + 1, key.shift);
      else if (key.pageUp) move(line - body, key.shift);
      else if (key.pageDown) move(line + body, key.shift);
      else if (key.leftArrow) setColumn((c) => Math.max(0, c - HORIZONTAL_STEP));
      else if (key.rightArrow) setColumn((c) => c + HORIZONTAL_STEP);
      else if (input === "g") move(0, false);
      else if (input === "G") move(display.length - 1, false);
      else if (input === "w") {
        setWrap((value) => !value);
        setColumn(0);
      } else if (input === "/") setSearching(true);
      else if (input === "n" && matches.length > 0) {
        const next = (matchPos + 1) % matches.length;
        setMatchPos(next);
        move(matches[next]!, false);
      } else if (input === "N" && matches.length > 0) {
        const previous = (matchPos - 1 + matches.length) % matches.length;
        setMatchPos(previous);
        move(matches[previous]!, false);
      }
    },
    { isActive: focused },
  );

  useShortcuts(
    id,
    "Log",
    [
      { keys: "↑↓ pgup/pgdn", label: "move" },
      { keys: "shift+↑↓", label: "select" },
      { keys: "ctrl-c", label: "copy selection" },
      { keys: "←→", label: "pan" },
      { keys: "w", label: "wrap" },
      { keys: "/", label: "search" },
      { keys: "n/N", label: "next/prev match" },
    ],
    focused,
  );

  const window = display.slice(from, from + body);
  const below = display.length - (from + window.length);
  return (
    <Box flexDirection="column" width={width}>
      {searching ? (
        <Text>
          <Text color="cyan">search: </Text>
          {query}
          <Text inverse> </Text>
        </Text>
      ) : (
        <Text dimColor wrap="truncate">
          {from > 0 ? `↑ ${from} more above` : " "}
          {copied > 0 ? `  · copied ${copied} line${copied === 1 ? "" : "s"}` : ""}
          {column > 0 ? `  · → column ${column}` : ""}
        </Text>
      )}
      {window.length === 0 ? (
        <Text dimColor>no output recorded</Text>
      ) : (
        window.map((entry, offset) => {
          const at = from + offset;
          const isCursor = at === line;
          const selected = selection !== undefined && at >= selection[0] && at <= selection[1];
          const matched = query !== "" && entry.text.toLowerCase().includes(query.toLowerCase());
          const text = wrap ? entry.text : entry.text.slice(column, column + width);
          return (
            <Text
              key={at}
              color={STREAM_COLOR[entry.stream]}
              dimColor={entry.stream === "system" && !isCursor && !selected}
              inverse={(isCursor && focused) || selected}
              backgroundColor={matched && !selected ? "yellow" : undefined}
            >
              {text || " "}
            </Text>
          );
        })
      )}
      {below > 0 && (
        <Text dimColor>
          ↓ {below} more below{matches.length > 0 ? ` · ${matches.length} matches` : ""}
        </Text>
      )}
    </Box>
  );
}
