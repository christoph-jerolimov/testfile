import { resolve } from "node:path";
import type { Command } from "commander";
import { importRunArchive, packRun } from "@testfile.dev/sync";
import { color } from "@testfile.dev/core";
import { commandFailed, pickRun, reportImport, resolveHistoryBase } from "./shared.js";

export function registerArchive(program: Command): void {
  const archiveCommand = program
    .command("archive")
    .description("Pack recorded runs as .tgz archives and import them");

  archiveCommand
    .command("pack")
    .argument("[path]", "directory containing a .testfile folder", ".")
    .option("--run <id>", "run to pack, id prefix is enough (default: the latest run)")
    .option("-o, --output <file>", "target file (default: testfile-run-<id>.tgz)")
    .description("Pack a recorded run as a .tgz archive")
    .action((path: string, options: { run?: string; output?: string }) => {
      try {
        const base = resolveHistoryBase(path);
        const run = pickRun(base, options.run);
        const out = options.output ?? `testfile-run-${run.id}.tgz`;
        packRun(base, run.id, out);
        console.log(`${color(32, "✔")} packed run ${run.id} into ${out}`);
      } catch (err) {
        commandFailed(err);
      }
    });

  archiveCommand
    .command("import")
    .argument("<archive>", '.tgz ("archive pack") or .zip (a GitHub run artifact)')
    .argument("[path]", "directory containing a .testfile folder", ".")
    .description("Import a packed run into the local history")
    .action((archive: string, path: string) => {
      try {
        reportImport(importRunArchive(resolveHistoryBase(path), resolve(archive)));
      } catch (err) {
        commandFailed(err);
      }
    });
}
