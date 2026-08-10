import assert from "node:assert/strict";
import { test } from "node:test";
import { ansiLines, applyCodes, cssOf, stripAnsi } from "./ansi.js";

// the escape character, spelled out so this file stays free of control bytes
const ESC = String.fromCharCode(27);
const sgr = (params: string): string => `${ESC}[${params}m`;

// what the spans of a line say, without their styling
const plain = (lines: ReturnType<typeof ansiLines>): string[] =>
  lines.map((spans) => spans.map((span) => span.text).join(""));

test("text without escapes is one span per line", () => {
  const lines = ansiLines("first\nsecond\n\nfourth");
  assert.deepEqual(plain(lines), ["first", "second", "", "fourth"]);
  assert.deepEqual(lines[2], [], "an empty line has no spans");
  assert.deepEqual(lines[0][0].style, {});
});

test("a trailing newline does not invent a line of content", () => {
  assert.deepEqual(plain(ansiLines("one\n")), ["one", ""]);
  assert.deepEqual(plain(ansiLines("")), [""]);
});

test("logs recorded on Windows keep neither CR nor a blank line", () => {
  assert.deepEqual(plain(ansiLines("one\r\ntwo\r\n")), ["one", "two", ""]);
});

test("colour codes become spans, and reset ends them", () => {
  const [line] = ansiLines(`plain ${sgr("31")}red${sgr("0")} plain`);
  assert.deepEqual(
    line.map((span) => span.text),
    ["plain ", "red", " plain"],
  );
  assert.equal(line[0].style.fg, undefined);
  assert.equal(line[1].style.fg, "var(--ansi-red)");
  assert.equal(line[2].style.fg, undefined);
});

test("a style stays open across a line break, as it does in a terminal", () => {
  const lines = ansiLines(`${sgr("32")}green\nstill green${sgr("39")} plain`);
  assert.equal(lines[0][0].style.fg, "var(--ansi-green)");
  assert.equal(lines[1][0].style.fg, "var(--ansi-green)");
  assert.equal(lines[1][1].style.fg, undefined);
});

test("weights and their explicit ends", () => {
  assert.deepEqual(applyCodes({}, "1;4"), { bold: true, underline: true });
  assert.deepEqual(applyCodes({ bold: true, dim: true }, "22"), { bold: false, dim: false });
  assert.deepEqual(applyCodes({ italic: true }, "23"), { italic: false });
  assert.deepEqual(applyCodes({ underline: true }, "24"), { underline: false });
  assert.deepEqual(applyCodes({ inverse: true }, "27"), { inverse: false });
  // a bare "[m" is a reset, and so is "[0m"
  assert.deepEqual(applyCodes({ bold: true, fg: "#ff5c69" }, ""), {});
  assert.deepEqual(applyCodes({ bold: true, fg: "#ff5c69" }, "0"), {});
});

test("bright, background and 256-colour forms", () => {
  assert.equal(applyCodes({}, "91").fg, "var(--ansi-bright-red)");
  assert.equal(applyCodes({}, "42").bg, "var(--ansi-green)");
  assert.equal(applyCodes({}, "102").bg, "var(--ansi-bright-green)");
  assert.equal(applyCodes({ bg: "var(--ansi-green)" }, "49").bg, undefined);
  // 256-colour: a named one, one from the cube, one from the greys
  assert.equal(applyCodes({}, "38;5;1").fg, "var(--ansi-red)");
  assert.equal(applyCodes({}, "38;5;46").fg, "#00ff00");
  assert.equal(applyCodes({}, "38;5;244").fg, "#808080");
  // 24-bit, and the codes after it are still read
  assert.deepEqual(applyCodes({}, "38;2;18;52;86;1"), { fg: "#123456", bold: true });
});

test("every other escape sequence is dropped rather than printed", () => {
  // a cursor move, a clear line, an OSC title, and a bare escape
  const noisy = `${ESC}[2Kkept${ESC}[1;3H more${ESC}]0;title${ESC}\\ end${ESC}M`;
  assert.deepEqual(plain(ansiLines(noisy)), ["kept more end"]);
  assert.equal(stripAnsi(`${sgr("31")}red${sgr("0")}`), "red");
});

test("cssOf turns a style into what the browser needs", () => {
  assert.deepEqual(cssOf({}), {});
  assert.deepEqual(cssOf({ fg: "#ff5c69", bold: true }), {
    color: "#ff5c69",
    fontWeight: 600,
  });
  assert.deepEqual(cssOf({ dim: true, italic: true, underline: true }), {
    opacity: 0.65,
    fontStyle: "italic",
    textDecoration: "underline",
  });
  // inverse swaps the two, falling back to the log's own colours
  assert.deepEqual(cssOf({ inverse: true }), {
    color: "var(--log-bg)",
    background: "var(--log-fg)",
  });
  assert.deepEqual(cssOf({ inverse: true, fg: "var(--ansi-green)", bg: "#123456" }), {
    color: "#123456",
    background: "var(--ansi-green)",
  });
});
