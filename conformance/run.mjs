#!/usr/bin/env node
// Runs every conformance case against the runner under test.
//
//   node run.mjs [case-name-filter]
//
// The runner defaults to this repository's reference runner; set
// TESTFILE_RUNNER to test another implementation, e.g.
// TESTFILE_RUNNER="testfile-go".
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

const here = dirname(fileURLToPath(import.meta.url));
const runner =
  process.env.TESTFILE_RUNNER ?? `node "${join(here, "..", "runner-ts", "dist", "cli.js")}"`;
const filter = process.argv[2];

let failures = 0;
let ran = 0;

for (const name of readdirSync(join(here, "cases")).sort()) {
  if (filter && !name.includes(filter)) continue;
  ran++;
  const caseDir = join(here, "cases", name);
  const expected = parse(readFileSync(join(caseDir, "expected.yaml"), "utf8"));

  // hermetic: every case runs on a fresh copy and may write files
  const work = mkdtempSync(join(tmpdir(), `testfile-conformance-`));
  cpSync(caseDir, work, { recursive: true });
  rmSync(join(work, "expected.yaml"));
  const resultFile = join(work, "conformance-result.json");

  const proc = spawnSync("sh", ["-c", `${runner} run "${work}" --reporter json --output "${resultFile}"`], {
    encoding: "utf8",
    env: { ...process.env, ...(expected.env ?? {}) },
    timeout: 120_000,
  });

  const problems = [];
  if (proc.status !== expected.exitCode) {
    problems.push(`exit code: expected ${expected.exitCode}, got ${proc.status}`);
  }
  let report;
  if (existsSync(resultFile)) {
    report = JSON.parse(readFileSync(resultFile, "utf8"));
  } else {
    problems.push("no JSON report was written");
  }
  if (report) {
    if (report.status !== expected.status) {
      problems.push(`run status: expected ${expected.status}, got ${report.status}`);
    }
    for (const want of expected.tests ?? []) {
      const got = report.tests.find((t) => t.path === want.path);
      if (!got) problems.push(`missing test "${want.path}" in the report`);
      else if (got.status !== want.status) {
        problems.push(`test "${want.path}": expected ${want.status}, got ${got.status}`);
      }
    }
    for (const path of expected.absentTests ?? []) {
      if (report.tests.some((t) => t.path === path)) {
        problems.push(`test "${path}" must not appear in the report`);
      }
    }
  }

  if (problems.length === 0) {
    console.log(`  ok      ${name}`);
  } else {
    failures++;
    console.error(`  FAILED  ${name}`);
    for (const problem of problems) console.error(`          ${problem}`);
    if (proc.stdout) console.error(indent(tail(proc.stdout)));
    if (proc.stderr) console.error(indent(tail(proc.stderr)));
  }
  rmSync(work, { recursive: true, force: true });
}

function tail(text) {
  return text.trim().split("\n").slice(-12).join("\n");
}

function indent(text) {
  return text
    .split("\n")
    .map((line) => `          | ${line}`)
    .join("\n");
}

if (ran === 0) {
  console.error("no cases matched");
  process.exit(1);
}
console.log(failures === 0 ? `\nall ${ran} conformance cases passed` : `\n${failures}/${ran} cases FAILED`);
process.exit(failures === 0 ? 0 : 1);
