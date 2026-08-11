// Entry point of the viewer TUI. Imported lazily by the CLI so plain
// history commands never pay for React/Ink.
import { render } from "ink";
import React from "react";
import { type RunHistory } from "@testfile/core";
import { App, type ViewerView } from "./app.js";
import { MOUSE_DISABLE, MOUSE_ENABLE } from "./mouse.js";

export const ALT_SCREEN_ENABLE = "[?1049h";
export const ALT_SCREEN_DISABLE = "[?1049l";

export type { ViewerView } from "./app.js";

export interface TuiHandle {
  waitUntilExit(): Promise<void>;
}

export function startTui(
  history: RunHistory,
  options: { baseDir: string; name?: string; view?: ViewerView },
): TuiHandle {
  // The alternate screen puts the layout at terminal row 1, which is what
  // lets mouse clicks map exactly onto table rows.
  process.stdout.write(ALT_SCREEN_ENABLE);
  const app = render(
    React.createElement(App, {
      history,
      baseDir: options.baseDir,
      name: options.name,
      initialView: options.view ?? "runs",
    }),
    { exitOnCtrlC: false },
  );
  process.stdout.write(MOUSE_ENABLE);
  let restored = false;
  const restore = (): void => {
    if (!restored) {
      restored = true;
      process.stdout.write(MOUSE_DISABLE);
      process.stdout.write(ALT_SCREEN_DISABLE);
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
