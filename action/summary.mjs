#!/usr/bin/env node
// Writes a Markdown table of the most recent recorded run to the job
// summary ($GITHUB_STEP_SUMMARY). Used by the composite action after
// `testfile run`; exits quietly when there is no run record.
//
//   node summary.mjs <tested-path>
import { appendFileSync } from "node:fs";
import { formatMs, latestRun } from "./record.mjs";

const summaryFile = process.env.GITHUB_STEP_SUMMARY;
if (!summaryFile) process.exit(0);
const located = latestRun(process.argv[2]);
if (!located) process.exit(0);
const { run } = located;

const STATUS = {
  passed: "✅ passed",
  failed: "❌ failed",
  aborted: "⛔ aborted",
  skipped: "↷ skipped",
  running: "▶ running",
  pending: "· pending",
};

// | and newlines would break the Markdown table
const cell = (text) => String(text).replaceAll("|", "\\|").replaceAll("\n", " ");

const counts = new Map();
for (const test of run.tests ?? []) counts.set(test.status, (counts.get(test.status) ?? 0) + 1);
const countSummary =
  [...counts.entries()].map(([status, n]) => `${n} ${status}`).join(", ") || "no tests";

const lines = [
  `## Testfile: ${STATUS[run.status] ?? run.status}`,
  "",
  `\`${run.id}\` — ${countSummary} · ${formatMs(run.durationMs)} · exit code ${run.exitCode}` +
    (run.cancelled ? " · cancelled" : ""),
  "",
  "| Test | Status | Duration | Notes |",
  "| ---- | ------ | -------- | ----- |",
];
for (const test of run.tests ?? []) {
  const notes = [
    test.cached ? "cached" : "",
    test.artifacts?.length ? `${test.artifacts.length} artifacts` : "",
  ]
    .filter(Boolean)
    .join(", ");
  lines.push(
    `| \`${cell(test.path)}\` | ${STATUS[test.status] ?? cell(test.status)} | ${formatMs(
      test.durationMs
    )} | ${cell(notes)} |`
  );
}
lines.push("");

appendFileSync(summaryFile, `${lines.join("\n")}\n`);
