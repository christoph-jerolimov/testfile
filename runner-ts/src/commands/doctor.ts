import { existsSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { Command } from "commander";
import { runChecks, worstOf, type Check } from "../doctor.js";
import { loadTestfile } from "../loader.js";
import type { TestfileDoc } from "../model.js";
import { color } from "../util.js";
import { wantsJson, writeJson } from "./shared.js";

const MARK: Record<Check["status"], string> = {
  ok: color(32, "✔"),
  warn: color(33, "!"),
  fail: color(31, "✘"),
};

export function registerDoctor(program: Command): void {
  program
    .command("doctor")
    .argument("[path]", "Testfile or directory containing one", ".")
    .option("--json [file]", "write the checks as JSON, to a file or (without a value) stdout")
    .description("Check this machine against what the Testfile needs (engine, ports, git, ...)")
    .action(async (path: string, options: { json?: string | boolean }) => {
      const target = resolve(path);
      const baseDir =
        existsSync(target) && statSync(target).isDirectory() ? target : dirname(target);

      // A missing or broken Testfile is a finding, not a crash: the machine
      // checks still say something useful.
      let doc: TestfileDoc | undefined;
      let testfile: Check;
      try {
        const loaded = loadTestfile(path);
        doc = loaded.doc;
        testfile = { name: "Testfile", status: "ok", detail: loaded.path };
      } catch (err) {
        testfile = {
          name: "Testfile",
          status: "warn",
          detail: err instanceof Error ? err.message : String(err),
          hint: "`testfile init` writes one; `testfile validate` explains a rejected file",
        };
      }

      const checks = [testfile, ...(await runChecks(doc, baseDir))];
      const worst = worstOf(checks);

      if (wantsJson(options.json)) {
        writeJson({ status: worst, checks }, options.json, "checks");
      } else {
        const width = Math.max(...checks.map((check) => check.name.length));
        for (const check of checks) {
          console.log(`${MARK[check.status]} ${check.name.padEnd(width)}  ${check.detail}`);
          if (check.hint) console.log(`  ${color(90, `↳ ${check.hint}`)}`);
        }
        const failed = checks.filter((check) => check.status === "fail").length;
        const warned = checks.filter((check) => check.status === "warn").length;
        console.log(
          worst === "ok"
            ? color(32, `\nall ${checks.length} checks passed`)
            : `\n${failed} failed, ${warned} warning(s), ${checks.length} checks`,
        );
      }

      if (worst === "fail") process.exitCode = 1;
    });
}
