// Renders a captured TUI frame (text with SGR escape codes) as an SVG - the
// terminal equivalent of the web viewer's Playwright screenshots. Only the
// styles Ink emits are understood: bold, dim, inverse and the 16 foreground
// colors; that is exactly what the TUI uses.

interface Style {
  color?: string;
  bold: boolean;
  dim: boolean;
  inverse: boolean;
}

interface Span {
  text: string;
  style: Style;
}

// One fixed dark palette, close to what the e2e web screenshots use.
const BACKGROUND = "#1e1e2e";
const FOREGROUND = "#d4d4d8";
const COLORS: Record<number, string> = {
  30: "#3f3f46", // black
  31: "#f14c4c", // red
  32: "#23d18b", // green
  33: "#f5f543", // yellow
  34: "#3b8eea", // blue
  35: "#d670d6", // magenta
  36: "#29b8db", // cyan
  37: "#d4d4d8", // white
  90: "#71717a", // bright black - ink's "gray"
  91: "#f14c4c",
  92: "#23d18b",
  93: "#f5f543",
  94: "#3b8eea",
  95: "#d670d6",
  96: "#29b8db",
  97: "#fafafa",
};

const ESC = String.fromCharCode(27);
const SGR = new RegExp(`${ESC}\\[([0-9;]*)m`, "g");

// Splits one line into spans of uniform style, carrying the style state in.
function parseLine(line: string, style: Style): { spans: Span[]; style: Style } {
  const spans: Span[] = [];
  let current = { ...style };
  let at = 0;
  const push = (text: string): void => {
    if (text.length === 0) return;
    const last = spans[spans.length - 1];
    if (
      last &&
      last.style.color === current.color &&
      last.style.bold === current.bold &&
      last.style.dim === current.dim &&
      last.style.inverse === current.inverse
    ) {
      last.text += text;
    } else {
      spans.push({ text, style: { ...current } });
    }
  };
  for (const match of line.matchAll(SGR)) {
    push(line.slice(at, match.index));
    at = match.index + match[0].length;
    for (const code of (match[1] === "" ? "0" : match[1]).split(";").map(Number)) {
      if (code === 0) current = { bold: false, dim: false, inverse: false };
      else if (code === 1) current.bold = true;
      else if (code === 2) current.dim = true;
      else if (code === 7) current.inverse = true;
      else if (code === 22) {
        current.bold = false;
        current.dim = false;
      } else if (code === 27) current.inverse = false;
      else if (code === 39) current.color = undefined;
      else if (COLORS[code]) current.color = COLORS[code];
    }
  }
  push(line.slice(at));
  return { spans, style: current };
}

function escapeXml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// The frame as one standalone SVG. Cell metrics are fixed: the captures are
// deterministic, so the images are diffable like any other screenshot.
export function ansiToSvg(frame: string, options: { columns: number; rows: number }): string {
  const cellWidth = 8.4;
  const lineHeight = 19;
  const pad = 12;
  const width = Math.ceil(options.columns * cellWidth + pad * 2);
  const height = options.rows * lineHeight + pad * 2;
  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    `<rect width="100%" height="100%" fill="${BACKGROUND}" rx="8"/>`,
    `<g font-family="Menlo, Consolas, 'DejaVu Sans Mono', monospace" font-size="14">`,
  ];
  let style: Style = { bold: false, dim: false, inverse: false };
  const lines = frame.split("\n").slice(0, options.rows);
  lines.forEach((line, row) => {
    const parsed = parseLine(line, style);
    style = parsed.style;
    const y = pad + row * lineHeight;
    let column = 0;
    // Inverse cells become a filled rect behind the text - the cursor row.
    for (const span of parsed.spans) {
      if (span.style.inverse) {
        const x = pad + column * cellWidth;
        parts.push(
          `<rect x="${x.toFixed(1)}" y="${y}" width="${(span.text.length * cellWidth).toFixed(1)}" height="${lineHeight}" fill="${span.style.color ?? FOREGROUND}"/>`,
        );
      }
      column += span.text.length;
    }
    column = 0;
    const texts: string[] = [];
    for (const span of parsed.spans) {
      const x = pad + column * cellWidth;
      column += span.text.length;
      if (span.text.trim().length === 0) continue;
      const fill = span.style.inverse ? BACKGROUND : (span.style.color ?? FOREGROUND);
      const attrs = [
        `x="${x.toFixed(1)}"`,
        `fill="${fill}"`,
        // pin every span to the cell grid, whatever font the viewer has
        `textLength="${(span.text.length * cellWidth).toFixed(1)}"`,
        `lengthAdjust="spacingAndGlyphs"`,
        span.style.bold ? 'font-weight="bold"' : "",
        span.style.dim && !span.style.inverse ? 'opacity="0.55"' : "",
      ]
        .filter(Boolean)
        .join(" ");
      texts.push(`<tspan ${attrs}>${escapeXml(span.text)}</tspan>`);
    }
    if (texts.length > 0) {
      parts.push(`<text y="${y + 14}" xml:space="preserve">${texts.join("")}</text>`);
    }
  });
  parts.push("</g></svg>");
  return parts.join("\n");
}
