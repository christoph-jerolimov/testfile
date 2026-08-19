import type { Command } from "commander";
import { commandFailed, explainOf, formatExplain, wantsJson, writeJson } from "@testfile.dev/core";
import { findRun, loadedHistory } from "./shared.js";

export function registerExplain(program: Command): void {
  program
    .command("explain")
    .argument("[run]", "recorded run to digest (a unique id prefix is enough; default: the latest)")
    .argument("[path]", "directory containing a .testfile folder", ".")
    .option("--log-lines <n>", "lines of log kept per failure", (value: string) =>
      Number.parseInt(value, 10),
    )
    .option("--max-failures <n>", "how many failures are detailed", (value: string) =>
      Number.parseInt(value, 10),
    )
    .option("--json [file]", "write the digest as JSON, to a file or (without a value) stdout")
    .description("Summarize one run: what failed, why, and what changed since the run before")
    .action(
      (
        runId: string | undefined,
        path: string,
        options: { logLines?: number; maxFailures?: number; json?: string | boolean },
      ) => {
        try {
          for (const [flag, value] of [
            ["--log-lines", options.logLines],
            ["--max-failures", options.maxFailures],
          ] as const) {
            if (value !== undefined && !(value >= 0)) {
              throw new Error(`${flag} must be a non-negative integer`);
            }
          }
          const history = loadedHistory(path);
          const run = runId === undefined ? history.runs[0]! : findRun(history, runId);
          const explain = explainOf(history, run, {
            ...(options.logLines !== undefined ? { logLines: options.logLines } : {}),
            ...(options.maxFailures !== undefined ? { maxFailures: options.maxFailures } : {}),
          });
          if (wantsJson(options.json)) {
            writeJson(explain, options.json);
            return;
          }
          process.stdout.write(formatExplain(explain));
        } catch (err) {
          commandFailed(err);
        }
      },
    );
}
