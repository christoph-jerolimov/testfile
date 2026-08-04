import type { Command } from "commander";
import { initTestfile } from "../init.js";
import { color } from "../util.js";
import { collect } from "./shared.js";
import { resolve } from "node:path";

export function registerInit(program: Command): void {
program
  .command("init")
  .argument("[path]", "directory to create the Testfile in", ".")
  .option(
    "--from <file>",
    "import from a docker-compose file, GitHub workflow, Makefile, Taskfile or justfile (repeatable)",
    collect,
    []
  )
  .option("--no-detect", "do not look for importable files automatically")
  .description(
    "Create a starter Testfile from package.json scripts, docker-compose files, workflows, Makefiles"
  )
  .action((path: string, options: { from: string[]; detect: boolean }) => {
    try {
      const sources = options.from.length > 0 ? options.from.map((file) => resolve(file)) : undefined;
      const { path: file, content, imported, notes } = initTestfile(path, {
        sources,
        detect: options.detect,
      });
      console.log(content);
      console.log(`${color(32, "✔")} wrote ${file}`);
      if (imported.length > 0) console.log(color(90, `imported from: ${imported.join(", ")}`));
      for (const note of notes) console.log(color(33, `! ${note}`));
      console.log(color(90, "run it with: testfile run   (or testfile-viewer tui)"));
    } catch (err) {
      console.error(`${color(31, "✘")} ${err instanceof Error ? err.message : err}`);
      process.exitCode = 1;
    }
  });
}
