import { existsSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Command } from "commander";
import {
  mergedRunId,
  readRunFolder,
  variantLabel,
  writeMergedRun,
  type MergeSource,
} from "../merge.js";
import { HISTORY_DIR, RunHistory } from "../runrecord.js";
import { color, formatMs } from "../util.js";
import { colorStatus, commandFailed, resolveHistoryBase } from "./shared.js";

// A run to merge, named either as a folder (what a CI artifact unpacks to)
// or as an id (or id prefix) in the history the merge writes to.
function resolveSource(name: string, baseDir: string, history: RunHistory): MergeSource {
  const asPath = resolve(name);
  if (existsSync(join(asPath, "run.yaml"))) return readRunFolder(asPath);
  // a folder that contains a history rather than a single run
  if (existsSync(join(asPath, HISTORY_DIR, "runs"))) {
    throw new Error(
      `${name} holds a whole history - name the runs to merge, e.g. ${name}/${HISTORY_DIR}/runs/<id>`
    );
  }
  if (existsSync(asPath) && statSync(asPath).isDirectory()) {
    throw new Error(`${name} has no run.yaml`);
  }
  const record = history.find(name);
  if (!record) throw new Error(`no recorded run "${name}" in ${baseDir}/${HISTORY_DIR}/runs/`);
  return { dir: join(baseDir, HISTORY_DIR, "runs", record.id), record };
}

export function registerMerge(program: Command): void {
program
  .command("merge")
  .argument(
    "<run...>",
    "runs to combine: run folders (an unpacked CI artifact) or ids in the target history"
  )
  .option("--dir <path>", "history the merged run is written to", ".")
  .option("--id-suffix <suffix>", "last part of the merged run's id", "merged")
  .description("Combine several runs (shards, or one job per platform) into a single run")
  .action((names: string[], options: { dir: string; idSuffix: string }) => {
    try {
      const baseDir = resolveHistoryBase(options.dir);
      const history = new RunHistory(baseDir);
      const sources = names.map((name) => resolveSource(name, options.dir, history));

      const id = mergedRunId(sources, options.idSuffix);
      const { record } = writeMergedRun(baseDir, sources, id);

      console.log(`${color(1, `merged run ${record.id}`)}`);
      for (const source of record.merged?.runs ?? []) {
        const where = variantLabel(source.variants);
        console.log(
          `  ${colorStatus(source.status)}  ${source.id}` +
            (where ? color(90, `  [${where}]`) : "") +
            color(90, `  ${formatMs(source.durationMs)}`)
        );
      }
      console.log(
        `${colorStatus(record.status)} (exit code ${record.exitCode}), ` +
          `${record.tests.length} test${record.tests.length === 1 ? "" : "s"}, ` +
          formatMs(record.durationMs)
      );
      console.log(color(90, `\ndetails: testfile-viewer run ${record.id}`));
      if (record.status !== "passed") process.exitCode = 1;
    } catch (err) {
      commandFailed(err);
    }
  });
}
