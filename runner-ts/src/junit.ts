// JUnit XML built from a run record alone - used to place a junit.xml
// into every recorded run folder, so CI tooling can consume the result
// without a separate reporter invocation.
import type { RunRecord, RunRecordTest } from "./history.js";

export interface JunitOptions {
  // Project name for the <testsuites> element (defaults to "testfile").
  name?: string;
  // The merged log of a test, for <failure> bodies.
  readLog: (test: RunRecordTest) => string | undefined;
}

// Group nodes appear in the record next to the leaves; a test is a group
// when another test's path nests below it.
function leafTests(record: RunRecord): RunRecordTest[] {
  const groups = new Set<string>();
  for (const test of record.tests) {
    for (const other of record.tests) {
      if (other.path.startsWith(`${test.path}/`)) {
        groups.add(test.path);
        break;
      }
    }
  }
  return record.tests.filter((test) => !groups.has(test.path));
}

export function junitFromRecord(record: RunRecord, options: JunitOptions): string {
  const leaves = leafTests(record);
  const failures = leaves.filter((l) => l.status === "failed" || l.status === "aborted").length;
  const skipped = leaves.filter((l) => l.status === "skipped").length;
  const time = (record.durationMs / 1000).toFixed(3);
  const suiteName = record.tests[0]?.path.split("/")[0] ?? "testfile";

  const cases = leaves.map((leaf) => {
    const lastSlash = leaf.path.lastIndexOf("/");
    const name = lastSlash >= 0 ? leaf.path.slice(lastSlash + 1) : leaf.path;
    const classname = lastSlash >= 0 ? leaf.path.slice(0, lastSlash) : leaf.path;
    const caseTime = leaf.durationMs !== undefined ? (leaf.durationMs / 1000).toFixed(3) : "0.000";
    const open = `    <testcase name="${escapeXml(name)}" classname="${escapeXml(classname)}" time="${caseTime}"`;
    if (leaf.status === "passed") return `${open}/>`;
    if (leaf.status === "skipped") return `${open}>\n      <skipped/>\n    </testcase>`;
    const log = escapeXml(options.readLog(leaf) ?? "");
    return `${open}>\n      <failure message="${escapeXml(leaf.status)}">${log}</failure>\n    </testcase>`;
  });

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<testsuites name="${escapeXml(options.name ?? "testfile")}" tests="${leaves.length}" failures="${failures}" skipped="${skipped}" time="${time}">`,
    `  <testsuite name="${escapeXml(suiteName)}" tests="${leaves.length}" failures="${failures}" skipped="${skipped}" time="${time}" timestamp="${escapeXml(record.startedAt)}">`,
    ...cases,
    "  </testsuite>",
    "</testsuites>",
    "",
  ].join("\n");
}

function escapeXml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}
