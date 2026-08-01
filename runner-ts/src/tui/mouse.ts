// Mouse-wheel support for the TUI. The terminal is switched into SGR mouse
// reporting while the TUI runs; wheel events arrive on stdin as
// "\x1b[<64;x;yM" (up) / "\x1b[<65;x;yM" (down) sequences.

export const MOUSE_ENABLE = "\u001b[?1000h\u001b[?1006h";
export const MOUSE_DISABLE = "\u001b[?1006l\u001b[?1000l";

export interface WheelEvent {
  direction: "up" | "down";
  // 1-based terminal cell coordinates of the pointer.
  x: number;
  y: number;
}

// Ink's key parser may strip the leading ESC before handing the sequence
// to useInput, so it is optional here.
const SGR_MOUSE = /(?:\u001b)?\[<(\d+);(\d+);(\d+)([Mm])/g;

// Extracts wheel events from a chunk of terminal input. Button presses,
// releases and moves are reported too when mouse mode is on - everything
// that is not a wheel event is ignored.
export function parseWheelEvents(data: string): WheelEvent[] {
  const events: WheelEvent[] = [];
  for (const match of data.matchAll(SGR_MOUSE)) {
    if (match[4] !== "M") continue; // wheel events are always presses
    const button = Number.parseInt(match[1], 10);
    if (button !== 64 && button !== 65) continue;
    events.push({
      direction: button === 64 ? "up" : "down",
      x: Number.parseInt(match[2], 10),
      y: Number.parseInt(match[3], 10),
    });
  }
  return events;
}

// True when a chunk of input (as Ink's useInput receives it) is a mouse
// report rather than a keypress - those must not trigger key bindings.
export function isMouseSequence(input: string): boolean {
  return input.includes("[<");
}
