import { writeFileSync } from "node:fs";
import type { Session } from "./session.js";
import { walk, type RunTest } from "./runsuite.js";

export type ReporterKind = "junit" | "json";

// Machine-readable result of the session's most recent run, for CI systems.
export function buildReport(session: Session, kind: ReporterKind): string {
  return kind === "junit" ? buildJUnitXml(session) : buildJsonReport(session);
}

export function writeReport(session: Session, kind: ReporterKind, output: string): void {
  const content = buildReport(session, kind);
  if (output === "-") process.stdout.write(content);
  else writeFileSync(output, content);
}

// The last run as JSON: exactly what the run's run.yaml records.
export function buildJsonReport(session: Session): string {
  if (!session.lastRecord) throw new Error("no run to report");
  return `${JSON.stringify(session.lastRecord, null, 2)}\n`;
}

// JUnit XML with one testcase per executed test test. Group paths become the
// classname, failures carry the merged log, skipped tests are marked.
export function buildJUnitXml(session: Session): string {
  const record = session.lastRecord;
  if (!record) throw new Error("no run to report");

  const tests: RunTest[] = [];
  walk(session.suite, (test) => {
    if (test.children.length === 0 && test.status !== "pending") tests.push(test);
  });

  const failures = tests.filter((l) => l.status === "failed" || l.status === "aborted").length;
  const skipped = tests.filter((l) => l.status === "skipped").length;
  const time = (record.durationMs / 1000).toFixed(3);

  const cases = tests.map((test) => {
    const classname = test.path.includes("/")
      ? test.path.slice(0, test.path.lastIndexOf("/"))
      : test.path;
    const caseTime =
      test.startedAt !== undefined && test.endedAt !== undefined
        ? ((test.endedAt - test.startedAt) / 1000).toFixed(3)
        : "0.000";
    const open = `    <testcase name="${escapeXml(test.name)}" classname="${escapeXml(classname)}" time="${caseTime}"`;
    if (test.status === "passed") return `${open}/>`;
    if (test.status === "skipped") return `${open}>\n      <skipped/>\n    </testcase>`;
    const message = escapeXml(test.error ?? test.status);
    const log = escapeXml(test.output.text());
    return `${open}>\n      <failure message="${message}">${log}</failure>\n    </testcase>`;
  });

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<testsuites name="${escapeXml(session.doc.name ?? "testfile")}" tests="${tests.length}" failures="${failures}" skipped="${skipped}" time="${time}">`,
    `  <testsuite name="${escapeXml(session.suite.name)}" tests="${tests.length}" failures="${failures}" skipped="${skipped}" time="${time}" timestamp="${escapeXml(record.startedAt)}">`,
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
