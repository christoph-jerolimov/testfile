import { dirname } from "node:path";
import { type Command } from "commander";
import { color, loadTestfile, Session } from "@testfile.dev/runner";
import {
  addFilterOptions,
  applyChanged,
  applyShard,
  type FilterFlags,
  printSuite,
  resolveFilters,
  suiteJson,
  wantsJson,
  writeJson,
} from "./shared.js";

// Returns the command, so `inspect run <id>` can hang off it: inspecting
// the suite and inspecting one recorded run are the same question asked of
// the two halves of the tool.
export function registerInspect(program: Command): Command {
  const inspect = program
    .command("inspect")
    .argument("[path]", "Testfile or directory containing one", ".")
    .option("--json [file]", "write the suite as JSON, to a file or (without a value) stdout")
    .description("Print the expanded test suite without running it (including matrix instances)");
  addFilterOptions(inspect).action(
    async (path: string, flags: FilterFlags & { json?: string | boolean }) => {
      try {
        const { path: file, doc } = loadTestfile(path);
        const session = new Session(doc, dirname(file));
        let filtered = resolveFilters(session, flags);
        if (filtered.testCount === 0) throw new Error("no tests match the given filters");
        filtered = await applyChanged(session, filtered, flags);
        filtered = applyShard(session, filtered, flags.shard);
        if (wantsJson(flags.json)) {
          const tests = suiteJson(session, filtered.active);
          writeJson(
            { path: file, services: Object.keys(doc.services ?? {}), count: tests.length, tests },
            flags.json,
            "suite",
          );
          return;
        }
        printSuite(session, filtered.active);
      } catch (err) {
        console.error(`${color(31, "✘")} ${err instanceof Error ? err.message : err}`);
        process.exitCode = 1;
      }
    },
  );
  return inspect;
}
