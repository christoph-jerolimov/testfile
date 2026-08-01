// Shared helper of the action's post-run scripts: locates the most recent
// recorded run of the tested path. Each run is self-contained in
// .testfile/runs/<id>/ with its own run.yaml; the newest run is the one
// with the latest startedAt timestamp.
import { createRequire } from "node:module";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
// the yaml dependency of the runner workspace, hoisted in the action checkout
const require = createRequire(join(here, "..", "runner-ts", "package.json"));
const { parse } = require("yaml");

// Returns { baseDir, runsDir, run } for the latest recorded run, or
// undefined when there is none (e.g. the Testfile failed validation).
export function latestRun(pathArg) {
  const target = resolve(pathArg ?? ".");
  const baseDir = existsSync(target) && statSync(target).isFile() ? dirname(target) : target;
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
    return undefined; // no recorded runs
  }
  records.sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)));
  const run = records[0];
  return run ? { baseDir, runsDir, run } : undefined;
}

export function formatMs(ms) {
  if (typeof ms !== "number") return "-";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m${Math.round((ms % 60_000) / 1000)}s`;
}
