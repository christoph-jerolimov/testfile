import type { Command } from "commander";
import { loadTestfile } from "../loader.js";
import { color } from "../util.js";
import { wantsJson, writeJson } from "./shared.js";

export function registerValidate(program: Command): void {
  program
    .command("validate")
    .argument("[path]", "Testfile or directory containing one", ".")
    .option("--json [file]", "write the result as JSON, to a file or (without a value) stdout")
    .description("Validate a Testfile against the schema")
    .action((path: string, options: { json?: string | boolean }) => {
      try {
        const { path: file } = loadTestfile(path);
        if (wantsJson(options.json)) {
          writeJson({ path: file, valid: true }, options.json, "result");
          return;
        }
        console.log(`${color(32, "✔")} ${file} is valid`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        // The loader reports every schema violation in one message, one per
        // line; a consumer wants them apart.
        if (wantsJson(options.json)) {
          const [summary, ...errors] = message.split("\n");
          writeJson(
            { path, valid: false, message: summary, errors: errors.map((line) => line.trim()) },
            options.json,
            "result",
          );
        } else {
          console.error(`${color(31, "✘")} ${message}`);
        }
        process.exitCode = 1;
      }
    });
}
