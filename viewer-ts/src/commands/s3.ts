import type { Command } from "commander";
import { defaultExec, lineProgress, s3List, s3Pull, s3Push } from "../transfer/index.js";
import { color } from "@testfile/core";
import {
  commandFailed,
  pickRun,
  reportImport,
  resolveHistoryBase,
  wantsJson,
  writeJson,
} from "./shared.js";

export function registerS3(program: Command): void {
  const s3Command = program
    .command("s3")
    .description("Share runs via an S3 bucket (uses the aws CLI)");

  s3Command
    .command("push")
    .argument("<s3-prefix>", "s3://bucket/prefix to upload to")
    .argument("[path]", "directory containing a .testfile folder", ".")
    .option("--run <id>", "run to push, id prefix is enough (default: the latest run)")
    .description("Pack a recorded run and upload it to S3")
    .action((prefix: string, path: string, options: { run?: string }) => {
      try {
        const base = resolveHistoryBase(path);
        const run = pickRun(base, options.run);
        const url = s3Push(base, run.id, prefix);
        console.log(`${color(32, "✔")} pushed run ${run.id} to ${url}`);
      } catch (err) {
        commandFailed(err);
      }
    });

  s3Command
    .command("pull")
    .argument("<s3-prefix>", "s3://bucket/prefix to download from")
    .argument("[path]", "directory containing a .testfile folder", ".")
    .option("--run <id>", "exact run id to pull (default: the newest archive)")
    .description("Download a run archive from S3 into the local history")
    .action((prefix: string, path: string, options: { run?: string }) => {
      try {
        reportImport(
          s3Pull(resolveHistoryBase(path), prefix, options.run, defaultExec, lineProgress()),
        );
      } catch (err) {
        commandFailed(err);
      }
    });

  s3Command
    .command("list")
    .argument("<s3-prefix>", "s3://bucket/prefix to list")
    .option("--json [file]", "write the archives as JSON, to a file or (without a value) stdout")
    .description("List the run archives available under an S3 prefix (newest first)")
    .action((prefix: string, options: { json?: string | boolean }) => {
      try {
        const names = s3List(prefix);
        if (wantsJson(options.json)) {
          writeJson({ prefix, archives: names }, options.json);
          return;
        }
        if (names.length === 0) {
          console.log(color(90, `no run archives under ${prefix}`));
          return;
        }
        for (const name of names) console.log(name);
        console.log(color(90, `\npull one with: testfile-viewer s3 pull ${prefix} --run <id>`));
      } catch (err) {
        commandFailed(err);
      }
    });
}
