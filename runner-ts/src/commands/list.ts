import { dirname } from "node:path";
import type { Command } from "commander";
import { loadTestfile } from "../loader.js";
import { Session } from "../session.js";
import { color } from "../util.js";
import {
  addFilterOptions,
  applyChanged,
  applyShard,
  printSuite,
  resolveFilters,
  suiteJson,
  wantsJson,
  writeJson,
  type FilterFlags,
} from "./shared.js";

export function registerList(program: Command): void {
  addFilterOptions(
    program
      .command("list")
      .argument("[path]", "Testfile or directory containing one", ".")
      .option("--json [file]", "write the suite as JSON, to a file or (without a value) stdout")
      .description("Print the expanded test suite (including matrix instances)"),
  ).action(async (path: string, flags: FilterFlags & { json?: string | boolean }) => {
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
  });
}
