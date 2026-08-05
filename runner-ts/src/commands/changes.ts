import { existsSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { Command } from "commander";
import { collectGitChanges } from "../gitchanges.js";
import { color } from "../util.js";

export function registerChanges(program: Command): void {
  program
    .command("changes")
    .argument("[path]", "directory (or Testfile) whose git repository to inspect", ".")
    .option("--changed-since <ref>", "base branch/ref to diff against (default: auto-detected)")
    .option("--files", "print only the file paths, one per line", false)
    .option("--json [file]", "write the changes as JSON, to a file or (without a value) stdout")
    .description(
      "Show the files changed against the base branch - what --changed selects tests from",
    )
    .action(
      (
        path: string,
        options: { changedSince?: string; files: boolean; json?: string | boolean },
      ) => {
        try {
          const target = resolve(path);
          const dir =
            existsSync(target) && statSync(target).isDirectory() ? target : dirname(target);
          const changes = collectGitChanges(dir, options.changedSince);

          if (options.json !== undefined && options.json !== false) {
            const json = `${JSON.stringify(changes, null, 2)}\n`;
            if (typeof options.json === "string") {
              writeFileSync(options.json, json);
              console.log(color(90, `changes written to ${options.json}`));
            } else {
              process.stdout.write(json);
            }
            return;
          }
          if (options.files) {
            for (const file of changes.files) console.log(file.path);
            return;
          }

          console.log(`base:  ${changes.baseRef} (${changes.baseCommit.slice(0, 9)})`);
          console.log(`head:  ${changes.headCommit?.slice(0, 9) ?? "(no commits yet)"}`);
          console.log(`root:  ${changes.gitRoot}`);
          console.log("");
          if (changes.files.length === 0) {
            console.log(color(90, "no changes"));
            return;
          }
          const width = Math.max(...changes.files.map((file) => file.path.length), 4);
          console.log(color(90, `${"file".padEnd(width)}  source  status`));
          for (const file of changes.files) {
            console.log(`${file.path.padEnd(width)}  ${file.source.padEnd(6)}  ${file.status}`);
          }
          console.log(
            color(
              90,
              `\n${changes.files.length} changed file${changes.files.length === 1 ? "" : "s"}`,
            ),
          );
        } catch (err) {
          console.error(`${color(31, "✘")} ${err instanceof Error ? err.message : err}`);
          process.exitCode = 1;
        }
      },
    );
}
