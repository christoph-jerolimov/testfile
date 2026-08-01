#!/usr/bin/env node
// Emits GitHub workflow-command annotations for the most recent recorded
// run: one ::error per failed or aborted test, carrying the tail of its
// log. Used by the composite action after `testfile run`; exits quietly
// when there is no run record (e.g. the Testfile failed validation).
//
//   node annotate.mjs <tested-path>
import { createRequire } from "node:module";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
// the yaml dependency of the runner workspace, hoisted in the action checkout
const require = createRequire(join(here, "..", "runner-ts", "package.json"));
const { parse } = require("yaml");

const target = resolve(process.argv[2] ?? ".");
const baseDir = existsSync(target) && statSync(target).isFile() ? dirname(target) : target;

// Each run is self-contained in .testfile/runs/<id>/ with its own run.yaml;
// the newest run is the one with the latest startedAt timestamp.
const runsDir = join(baseDir, ".testfile", "runs");
const records = [];
try {
  for (const entry of readdirSync(runsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    try {
      const record = parse(readFileSync(join(runsDir, entry.name, "run.yaml"), "utf8"));
      if (record) records.push(record);
    } catch {
      // a run folder without a readable run.yaml is not a run
    }
  }
} catch {
  process.exit(0); // no recorded runs (e.g. the Testfile failed validation)
}
records.sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)));
const run = records[0];
if (!run) process.exit(0);

// %, CR and LF must be escaped in workflow command data
const escapeData = (text) => text.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A");
const escapeProp = (text) =>
  escapeData(text).replaceAll(":", "%3A").replaceAll(",", "%2C");

let failures = 0;
for (const test of run.tests ?? []) {
  if (test.status !== "failed" && test.status !== "aborted") continue;
  failures++;
  let detail = `status: ${test.status}`;
  if (test.log) {
    try {
      const log = readFileSync(join(baseDir, ".testfile", "runs", run.id, test.log), "utf8");
      const tail = log.trim().split("\n").slice(-15).join("\n");
      if (tail) detail = tail;
    } catch {
      // no log available; keep the status line
    }
  }
  console.log(`::error title=${escapeProp(`Testfile: ${test.path}`)}::${escapeData(detail)}`);
}

if (failures > 0) {
  console.log(
    `::notice title=Testfile::${failures} test${failures === 1 ? "" : "s"} failed in run ${run.id} (exit code ${run.exitCode})`
  );
}
