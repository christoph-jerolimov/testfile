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
  type FilterFlags,
} from "./shared.js";

export function registerList(program: Command): void {
  addFilterOptions(
    program
      .command("list")
      .argument("[path]", "Testfile or directory containing one", ".")
      .description("Print the expanded test suite (including matrix instances)"),
  ).action(async (path: string, flags: FilterFlags) => {
    try {
      const { path: file, doc } = loadTestfile(path);
      const session = new Session(doc, dirname(file));
      let filtered = resolveFilters(session, flags);
      if (filtered.testCount === 0) throw new Error("no tests match the given filters");
      filtered = await applyChanged(session, filtered, flags);
      filtered = applyShard(session, filtered, flags.shard);
      printSuite(session, filtered.active);
    } catch (err) {
      console.error(`${color(31, "✘")} ${err instanceof Error ? err.message : err}`);
      process.exitCode = 1;
    }
  });
}
