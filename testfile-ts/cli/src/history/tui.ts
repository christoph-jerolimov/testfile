import type { Command } from "commander";
import { commandFailed, resolveHistoryBase, RunHistory } from "@testfile.dev/core";

export function registerTui(program: Command): void {
  program
    .command("tui")
    .argument("[path]", "directory containing a .testfile folder", ".")
    .option("--view <view>", "initial tab: runs or tests (results is accepted as an alias)", "runs")
    .option("--name <name>", "display name shown in the header")
    .description("Interactive terminal UI over the recorded runs (watches for new runs)")
    .action(async (path: string, options: { view: string; name?: string }) => {
      try {
        if (!process.stdout.isTTY) {
          throw new Error("the TUI needs an interactive terminal (use: testfile runs)");
        }
        if (!["runs", "tests", "results"].includes(options.view)) {
          throw new Error(`unknown --view "${options.view}", expected runs or tests`);
        }
        const base = resolveHistoryBase(path);
        const history = new RunHistory(base);
        const { startTui } = await import("@testfile.dev/tui");
        const tui = startTui(history, {
          baseDir: base,
          name: options.name,
          view: options.view === "runs" ? "runs" : "tests",
        });
        await tui.waitUntilExit();
      } catch (err) {
        commandFailed(err);
      }
    });
}
