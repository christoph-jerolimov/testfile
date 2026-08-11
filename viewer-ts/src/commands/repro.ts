import type { Command } from "commander";
import { formatRepro, reproOf } from "@testfile/core";
import { commandFailed, findRun, loadedHistory, wantsJson, writeJson } from "./shared.js";

// "platform=linux" pairs into a map, to pick one leg of a merged run.
function parseVariants(pairs: string[]): Record<string, string> {
  const variants: Record<string, string> = {};
  for (const pair of pairs) {
    const at = pair.indexOf("=");
    if (at <= 0) throw new Error(`--variant expects key=value, got "${pair}"`);
    variants[pair.slice(0, at).trim()] = pair.slice(at + 1).trim();
  }
  return variants;
}

export function registerRepro(program: Command): void {
  program
    .command("repro")
    .argument("<run>", "recorded run the failure is in (a unique id prefix is enough)")
    .argument("<test>", "path of the test to reproduce, e.g. ci/unit")
    .argument("[path]", "directory containing a .testfile folder", ".")
    .option(
      "--variant <key=value>",
      "which leg of a merged run to reproduce, e.g. platform=linux (repeatable)",
      (value: string, previous: string[]) => [...previous, value],
      [],
    )
    .option("--log-lines <n>", "how much of the log to include", (value: string) =>
      Number.parseInt(value, 10),
    )
    .option("--json [file]", "write the bundle as JSON, to a file or (without a value) stdout")
    .description("Print everything needed to reproduce one recorded failure")
    .action(
      (
        runId: string,
        testPath: string,
        path: string,
        options: { variant: string[]; logLines?: number; json?: string | boolean },
      ) => {
        try {
          if (options.logLines !== undefined && !(options.logLines >= 0)) {
            throw new Error("--log-lines must be a non-negative integer");
          }
          const history = loadedHistory(path);
          const run = findRun(history, runId);
          const variants = parseVariants(options.variant);
          const repro = reproOf(history, run, testPath, {
            ...(options.logLines !== undefined ? { logLines: options.logLines } : {}),
            ...(Object.keys(variants).length > 0 ? { variants } : {}),
          });
          if (wantsJson(options.json)) {
            writeJson(repro, options.json);
            return;
          }
          process.stdout.write(formatRepro(repro));
        } catch (err) {
          commandFailed(err);
        }
      },
    );
}
