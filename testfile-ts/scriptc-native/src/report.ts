// testfile-report: what a recorded run came to, from a machine with nothing
// installed on it.
//
// `testfile start --reporter json --output run.json` writes the report; this
// reads it, prints the verdict and the tests that failed, and exits non-zero
// when the run did. That is a small job, and the point is what it costs: the
// binary is ~420 KB and contains no JavaScript engine at all, so it drops into
// a scratch container or a release image where installing node to read a JSON
// file would be the largest thing in the layer.
//
// Kept inside what scriptc 0.0.32 compiles: node:fs, JSON.parse, plain loops
// and template literals. See the README for what does not compile yet.

import { readFileSync } from "node:fs";

interface ReportTest {
  path: string;
  status: string;
  durationMs?: number;
}

interface Report {
  id: string;
  status: string;
  durationMs?: number;
  tests: ReportTest[];
}

// Not `process.argv[2] ?? ""`: scriptc bounds-checks arrays, so reading past
// the end aborts with `RangeError: array index 2 out of bounds` where
// JavaScript would hand back undefined. Ask the length first.
const file = process.argv.length > 2 ? process.argv[2] : "";
if (!file) {
  console.error("usage: testfile-report <report.json>");
  console.error("  the file written by: testfile start --reporter json --output <file>");
  process.exit(2);
}

let text = "";
try {
  text = readFileSync(file, "utf8");
} catch {
  console.error(`testfile-report: cannot read ${file}`);
  process.exit(2);
}

const report = JSON.parse(text) as Report;

let passed = 0;
let failed = 0;
let skipped = 0;
for (const test of report.tests) {
  if (test.status === "passed") passed++;
  else if (test.status === "failed") failed++;
  else skipped++;
}

const counts = `${passed} passed, ${failed} failed, ${skipped} other`;
console.log(`${report.id}  ${report.status}  (${counts})`);

if (failed > 0) {
  console.log("");
  for (const test of report.tests) {
    if (test.status === "failed") {
      const ms = test.durationMs ?? 0;
      console.log(`  ✘ ${test.path} (${ms}ms)`);
    }
  }
}

// The exit code is the useful half: a pipeline step can be this binary.
process.exit(report.status === "passed" ? 0 : 1);
