import type { Command } from "commander";
import { RunHistory } from "../runrecord.js";
import { commandFailed, resolveHistoryBase } from "./shared.js";

export function registerTui(program: Command): void {
program
  .command("tui")
  .argument("[path]", "directory containing a .testfile folder", ".")
  .option("--view <view>", "initial view: runs or results", "runs")
  .option("--name <name>", "display name shown in the header")
  .description("Interactive terminal UI over the recorded runs (watches for new runs)")
  .action(async (path: string, options: { view: string; name?: string }) => {
    try {
      if (!process.stdout.isTTY) {
        throw new Error("the TUI needs an interactive terminal (use: testfile-viewer runs)");
      }
      if (options.view !== "runs" && options.view !== "results") {
        throw new Error(`unknown --view "${options.view}", expected runs or results`);
      }
      const base = resolveHistoryBase(path);
      const history = new RunHistory(base);
      const { startTui } = await import("../tui/index.js");
      const tui = startTui(history, {
        baseDir: base,
        name: options.name,
        view: options.view as "runs" | "results",
      });
      await tui.waitUntilExit();
    } catch (err) {
      commandFailed(err);
    }
  });
}
