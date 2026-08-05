// Test logs are written by tools that colour their output, and the runner
// keeps that colour (it sets CI=1 and asks for colour on purpose). This turns
// the escape sequences back into something a browser can render: SGR is kept,
// every other escape sequence is dropped rather than printed.
import type { CSSProperties } from "react";

export interface AnsiStyle {
  fg?: string;
  bg?: string;
  bold?: boolean;
  dim?: boolean;
  italic?: boolean;
  underline?: boolean;
  inverse?: boolean;
}

export interface AnsiSpan {
  text: string;
  style: AnsiStyle;
}

// The palette of the viewer itself, so a coloured log looks like it belongs
// to the page it is on. Black is lifted off the background: a log that prints
// black on the default background is unreadable, everywhere.
const BASE = [
  "#3b424d",
  "#ff5c69",
  "#3ddc84",
  "#ffc857",
  "#4cc2ff",
  "#c792ea",
  "#57d1c9",
  "#d7dee8",
];

const BRIGHT = [
  "#6b7482",
  "#ff8b94",
  "#7ceaae",
  "#ffdd94",
  "#8ad8ff",
  "#dcb6f5",
  "#8ee6df",
  "#ffffff",
];

const DEFAULT_FG = "#d7dee8";
const DEFAULT_BG = "#0b0e13";

function hex(red: number, green: number, blue: number): string {
  return `#${[red, green, blue].map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

// The xterm 256-colour cube: 16 named colours, a 6×6×6 cube, then 24 greys.
function xterm(index: number): string | undefined {
  if (index < 0 || index > 255) return undefined;
  if (index < 8) return BASE[index];
  if (index < 16) return BRIGHT[index - 8];
  if (index < 232) {
    const step = (value: number): number => (value === 0 ? 0 : 55 + value * 40);
    const offset = index - 16;
    return hex(
      step(Math.floor(offset / 36) % 6),
      step(Math.floor(offset / 6) % 6),
      step(offset % 6),
    );
  }
  const grey = 8 + (index - 232) * 10;
  return hex(grey, grey, grey);
}

// "38;5;n" and "38;2;r;g;b" carry their colour in the codes that follow, so
// this reports how many of them it consumed.
function extended(codes: number[], at: number): { colour?: string; used: number } {
  if (codes[at] === 5) return { colour: xterm(codes[at + 1] ?? -1), used: 2 };
  if (codes[at] === 2) {
    const [red, green, blue] = [codes[at + 1] ?? 0, codes[at + 2] ?? 0, codes[at + 3] ?? 0];
    return { colour: hex(red & 255, green & 255, blue & 255), used: 4 };
  }
  return { used: 1 };
}

export function applyCodes(style: AnsiStyle, params: string): AnsiStyle {
  // A bare "ESC[m" is "ESC[0m" - a reset with the code left out.
  const codes = params === "" ? [0] : params.split(";").map((value) => Number(value) || 0);
  let next: AnsiStyle = { ...style };
  for (let at = 0; at < codes.length; at++) {
    const code = codes[at];
    if (code === 0) next = {};
    else if (code === 1) next.bold = true;
    else if (code === 2) next.dim = true;
    else if (code === 3) next.italic = true;
    else if (code === 4) next.underline = true;
    else if (code === 7) next.inverse = true;
    else if (code === 22) next = { ...next, bold: false, dim: false };
    else if (code === 23) next.italic = false;
    else if (code === 24) next.underline = false;
    else if (code === 27) next.inverse = false;
    else if (code >= 30 && code <= 37) next.fg = BASE[code - 30];
    else if (code >= 90 && code <= 97) next.fg = BRIGHT[code - 90];
    else if (code === 39) next.fg = undefined;
    else if (code >= 40 && code <= 47) next.bg = BASE[code - 40];
    else if (code >= 100 && code <= 107) next.bg = BRIGHT[code - 100];
    else if (code === 49) next.bg = undefined;
    else if (code === 38 || code === 48) {
      const { colour, used } = extended(codes, at + 1);
      if (code === 38) next.fg = colour;
      else next.bg = colour;
      at += used;
    }
  }
  return next;
}

// SGR ("ESC[…m") is kept; every other CSI sequence and every OSC string is
// matched only so it can be thrown away instead of showing up as text.
const ESCAPE =
  /\u001b\[([0-9;]*)m|\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][\s\S]*?(?:\u0007|\u001b\\)|\u001b[@-Z\\-_]/g;

// One array of spans per line, with the style carried across line breaks -
// a tool that opens a colour on one line and closes it on the next is
// rendered the way a terminal would render it.
export function ansiLines(text: string): AnsiSpan[][] {
  const lines: AnsiSpan[][] = [[]];
  let style: AnsiStyle = {};
  const push = (chunk: string): void => {
    if (chunk === "") return;
    const parts = chunk.split("\n");
    for (const [index, part] of parts.entries()) {
      if (index > 0) lines.push([]);
      // logs recorded on Windows arrive with CRLF
      const clean = part.replace(/\r$/, "");
      if (clean !== "") lines[lines.length - 1].push({ text: clean, style });
    }
  };

  ESCAPE.lastIndex = 0;
  let at = 0;
  for (let match = ESCAPE.exec(text); match; match = ESCAPE.exec(text)) {
    push(text.slice(at, match.index));
    at = match.index + match[0].length;
    if (match[1] !== undefined) style = applyCodes(style, match[1]);
  }
  push(text.slice(at));
  return lines;
}

export function stripAnsi(text: string): string {
  return text.replace(ESCAPE, "");
}

export function cssOf(style: AnsiStyle): CSSProperties {
  const fg = style.fg ?? DEFAULT_FG;
  const bg = style.bg;
  const css: CSSProperties = style.inverse
    ? { color: bg ?? DEFAULT_BG, background: fg }
    : { ...(style.fg ? { color: fg } : {}), ...(bg ? { background: bg } : {}) };
  if (style.bold) css.fontWeight = 600;
  if (style.dim) css.opacity = 0.65;
  if (style.italic) css.fontStyle = "italic";
  if (style.underline) css.textDecoration = "underline";
  return css;
}
