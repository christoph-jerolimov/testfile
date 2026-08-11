import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { TestfileDoc } from "./model.js";
import { Session } from "./session.js";
import { StreamReporter } from "./streamreporter.js";

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "testfile-"));
  process.on("exit", () => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

interface Event {
  event: string;
  [key: string]: unknown;
}

// Runs a document with the stream reporter attached and returns the events
// it wrote, parsed - the same lines a consumer would read from stdout.
async function streamOf(doc: TestfileDoc, verbose = false): Promise<Event[]> {
  const dir = tempDir();
  const session = new Session(doc, dir);
  const written: string[] = [];
  let reporter: StreamReporter | undefined;
  session.on("runner", (runner) => {
    reporter = new StreamReporter(runner, { verbose, selected: 2 }, (line) => written.push(line));
  });
  const status = await session.runAll();
  reporter!.runEnd({
    status: status!,
    exitCode: status === "passed" ? 0 : 1,
    runId: session.lastRecord?.id,
  });
  // every line is one complete JSON object, newline-terminated
  for (const line of written) assert.ok(line.endsWith("\n"), `no newline: ${line}`);
  return written.map((line) => JSON.parse(line) as Event);
}

test("the stream opens with run-start, ends with run-end and counts the leaves", async () => {
  const events = await streamOf({
    version: 0,
    test: {
      name: "root",
      sequence: [
        { name: "one", command: "echo one-out" },
        { name: "two", command: "echo two-err >&2; false", continueOnError: true },
      ],
    },
  });

  const first = events[0];
  assert.equal(first.event, "run-start");
  assert.equal(first.selected, 2);
  assert.match(String(first.at), /^\d{4}-\d{2}-\d{2}T/);

  const last = events[events.length - 1];
  assert.equal(last.event, "run-end");
  assert.equal(last.status, "passed", "continueOnError keeps the run passing");
  assert.equal(last.exitCode, 0);
  assert.match(String(last.runId), /^\d{8}-\d{6}-/);
  // only leaves are counted, so the root and its sequence are not in here
  assert.deepEqual(last.counts, { passed: 1, failed: 1 });
});

test("every test reports its start and its end, with the detail of the end", async () => {
  const events = await streamOf({
    version: 0,
    test: {
      name: "root",
      sequence: [
        { name: "one", command: "echo one-out" },
        { name: "two", command: "echo two-err >&2; false", continueOnError: true },
      ],
    },
  });

  const starts = events.filter((e) => e.event === "test-start").map((e) => e.path);
  assert.deepEqual(starts, ["root", "root/one", "root/two"]);

  const ends = events.filter((e) => e.event === "test-end");
  const one = ends.find((e) => e.path === "root/one")!;
  assert.equal(one.status, "passed");
  assert.ok((one.durationMs as number) >= 0);
  assert.equal(one.error, undefined, "a passing test has nothing to explain");

  const two = ends.find((e) => e.path === "root/two")!;
  assert.equal(two.status, "failed");
  assert.match(String(two.error), /exit|status|1/i);
});

test("output arrives as line events, tagged with the test and the stream", async () => {
  const events = await streamOf({
    version: 0,
    test: {
      name: "root",
      sequence: [
        { name: "one", command: "echo one-out" },
        { name: "two", command: "echo two-err >&2; false", continueOnError: true },
      ],
    },
  });

  const lines = events.filter((e) => e.event === "line");
  const out = lines.find((e) => String(e.text).includes("one-out"))!;
  assert.equal(out.path, "root/one");
  assert.equal(out.stream, "stdout");
  const err = lines.find((e) => String(e.text).includes("two-err"))!;
  assert.equal(err.path, "root/two");
  assert.equal(err.stream, "stderr");
  // a test's output is attributed to that test, never to a group
  assert.ok(!lines.some((e) => e.path === "root"));
});

test("a skipped test still ends, and says why it was not run", async () => {
  const events = await streamOf({
    version: 0,
    test: {
      name: "root",
      sequence: [
        { name: "one", command: "echo one" },
        { name: "two", command: "echo two", if: "false" },
      ],
    },
  });
  const two = events.find((e) => e.event === "test-end" && e.path === "root/two")!;
  assert.equal(two.status, "skipped");
  const last = events[events.length - 1];
  assert.deepEqual(last.counts, { passed: 1, skipped: 1 });
});
