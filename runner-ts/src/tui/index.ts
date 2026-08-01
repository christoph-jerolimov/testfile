// Entry point of the interactive terminal UI. The CLI imports this module
// lazily so plain runs never pay for React/Ink.
import { render } from "ink";
import React from "react";
import type { Session } from "../session.js";
import { App, type TuiView } from "./app.js";
import { MOUSE_DISABLE, MOUSE_ENABLE } from "./mouse.js";

export type { TuiView } from "./app.js";

export interface TuiHandle {
  waitUntilExit(): Promise<void>;
}

// Renders the TUI and switches the terminal into mouse-reporting mode, which
// is reliably switched off again when the TUI (or the process) exits.
export function startTui(
  session: Session,
  options: { initialSelection?: number[]; view?: TuiView } = {}
): TuiHandle {
  const app = render(
    React.createElement(App, {
      session,
      initialSelection: options.initialSelection ?? [],
      initialView: options.view ?? "tests",
    }),
    { exitOnCtrlC: false }
  );
  process.stdout.write(MOUSE_ENABLE);
  let restored = false;
  const restore = (): void => {
    if (!restored) {
      restored = true;
      process.stdout.write(MOUSE_DISABLE);
    }
  };
  process.once("exit", restore);
  return {
    waitUntilExit: async () => {
      try {
        await app.waitUntilExit();
      } finally {
        restore();
      }
    },
  };
}
