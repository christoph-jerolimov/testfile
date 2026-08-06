import type { Command } from "commander";
import { diffRuns } from "../runrecord.js";
import { color, formatMs, pad } from "../util.js";
import { commandFailed, findRun, loadedHistory, wantsJson, writeJson } from "./shared.js";

export function registerDiff(program: Command): void {
  program
    .command("diff")
    .argument("<older>", "run id to compare from (a unique prefix is enough)")
    .argument("<newer>", "run id to compare to")
    .argument("[path]", "directory containing a .testfile folder", ".")
    .option("--json [file]", "write the diff as JSON, to a file or (without a value) stdout")
    .description("Compare two recorded runs")
    .action((older: string, newer: string, path: string, options: { json?: string | boolean }) => {
      try {
        const history = loadedHistory(path);
        const base = findRun(history, older);
        const compare = findRun(history, newer);
        const diff = diffRuns(base, compare);
        if (wantsJson(options.json)) {
          writeJson({ base: base.id, compare: compare.id, ...diff }, options.json);
          return;
        }
        console.log(color(1, `${base.id} -> ${compare.id}`));
        const section = (label: string, code: number, paths: string[]): void => {
          for (const p of paths) console.log(`  ${pad(color(code, label), 13)} ${p}`);
        };
        section("newly failed", 31, diff.newlyFailed);
        section("fixed", 32, diff.fixed);
        section("still failing", 33, diff.stillFailing);
        section("added", 36, diff.added);
        section("removed", 90, diff.removed);
        for (const d of diff.durations) {
          const arrow = d.toMs > d.fromMs ? color(33, "slower") : color(32, "faster");
          console.log(
            `  ${pad(arrow, 13)} ${d.path} (${formatMs(d.fromMs)} -> ${formatMs(d.toMs)})`,
          );
        }
        const total =
          diff.newlyFailed.length +
          diff.fixed.length +
          diff.stillFailing.length +
          diff.added.length +
          diff.removed.length +
          diff.durations.length;
        if (total === 0) console.log(color(90, "  no differences"));
      } catch (err) {
        commandFailed(err);
      }
    });
}
