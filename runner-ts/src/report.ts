import { writeFileSync } from "node:fs";
import type { Session } from "./session.js";
import { walk, type RunNode } from "./runtree.js";

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

// JUnit XML with one testcase per executed leaf test. Group paths become the
// classname, failures carry the merged log, skipped tests are marked.
export function buildJUnitXml(session: Session): string {
  const record = session.lastRecord;
  if (!record) throw new Error("no run to report");

  const leaves: RunNode[] = [];
  walk(session.tree, (node) => {
    if (node.children.length === 0 && node.status !== "pending") leaves.push(node);
  });

  const failures = leaves.filter((l) => l.status === "failed" || l.status === "aborted").length;
  const skipped = leaves.filter((l) => l.status === "skipped").length;
  const time = (record.durationMs / 1000).toFixed(3);

  const cases = leaves.map((leaf) => {
    const classname = leaf.path.includes("/")
      ? leaf.path.slice(0, leaf.path.lastIndexOf("/"))
      : leaf.path;
    const caseTime =
      leaf.startedAt !== undefined && leaf.endedAt !== undefined
        ? ((leaf.endedAt - leaf.startedAt) / 1000).toFixed(3)
        : "0.000";
    const open = `    <testcase name="${escapeXml(leaf.name)}" classname="${escapeXml(classname)}" time="${caseTime}"`;
    if (leaf.status === "passed") return `${open}/>`;
    if (leaf.status === "skipped") return `${open}>\n      <skipped/>\n    </testcase>`;
    const message = escapeXml(leaf.error ?? leaf.status);
    const log = escapeXml(leaf.output.text());
    return `${open}>\n      <failure message="${message}">${log}</failure>\n    </testcase>`;
  });

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<testsuites name="${escapeXml(session.doc.name ?? "testfile")}" tests="${leaves.length}" failures="${failures}" skipped="${skipped}" time="${time}">`,
    `  <testsuite name="${escapeXml(session.tree.name)}" tests="${leaves.length}" failures="${failures}" skipped="${skipped}" time="${time}" timestamp="${escapeXml(record.startedAt)}">`,
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
