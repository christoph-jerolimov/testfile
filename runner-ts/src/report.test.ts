import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { buildJsonReport, buildJUnitXml } from "./report.js";
import { Session } from "./session.js";

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "testfile-report-"));
  process.on("exit", () => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

async function ranSession(): Promise<Session> {
  const session = new Session(
    {
      version: 0,
      name: "demo & more",
      test: {
        name: "all",
        sequence: [
          { name: "good", command: "echo fine" },
          { name: "bad <one>", command: "echo broken; false", continueOnError: true },
          { name: "conditional", if: "false", command: "true" },
        ],
      },
    },
    tempDir()
  );
  await session.runAll();
  return session;
}

test("buildJUnitXml reports cases, failures, skips and escapes markup", async () => {
  const session = await ranSession();
  const xml = buildJUnitXml(session);
  assert.match(xml, /<testsuites name="demo &amp; more" tests="3" failures="1" skipped="1"/);
  assert.match(xml, /<testcase name="good" classname="all" time="\d+\.\d{3}"\/>/);
  assert.match(xml, /<testcase name="bad &lt;one&gt;"[^>]*>\s*<failure message="exit code 1">/);
  assert.match(xml, /broken/);
  assert.match(xml, /<skipped\/>/);
  assert.ok(!xml.includes("<one>"), "raw markup must be escaped");
});

test("buildJsonReport is the parsed run record", async () => {
  const session = await ranSession();
  const parsed = JSON.parse(buildJsonReport(session));
  assert.equal(parsed.id, session.lastRecord!.id);
  assert.equal(parsed.status, "passed");
  assert.ok(parsed.tests.some((t: { path: string }) => t.path === "all/good"));
});

test("reports refuse to build without a run", () => {
  const session = new Session({ version: 0, test: { command: "true" } }, tempDir());
  assert.throws(() => buildJUnitXml(session), /no run to report/);
});
