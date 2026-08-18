import { type Command } from "commander";
import { color, loadTestfile } from "@testfile.dev/runner";
import { wantsJson, writeJson } from "./shared.js";

export function registerValidate(program: Command): void {
  program
    .command("validate")
    .argument("[path]", "Testfile or directory containing one", ".")
    .option("--json [file]", "write the result as JSON, to a file or (without a value) stdout")
    .description("Validate a Testfile against the schema")
    .action((path: string, options: { json?: string | boolean }) => {
      try {
        const { path: file, overrides } = loadTestfile(path);
        if (wantsJson(options.json)) {
          writeJson({ path: file, valid: true, overrides }, options.json, "result");
          return;
        }
        console.log(`${color(32, "✔")} ${file} is valid`);
        // Validating the file as it stands is not the same as validating
        // what a run would use, so the difference is named.
        if (overrides.length > 0) {
          const paths = overrides.map((override) => override.path).join(", ");
          console.log(color(90, `  with ${overrides.length} override(s): ${paths}`));
        }
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
