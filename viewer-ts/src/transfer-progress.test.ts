import assert from "node:assert/strict";
import { test } from "node:test";
import { lineProgress, type ProgressStream } from "./transfer/progress.js";

function recorder(isTTY: boolean): ProgressStream & { chunks: string[] } {
  const chunks: string[] = [];
  return {
    isTTY,
    chunks,
    write(text: string) {
      chunks.push(text);
    },
  };
}

test("piped output gets one plain line per event", () => {
  const stream = recorder(false);
  const progress = lineProgress(stream);
  progress.note("listing the last 2 workflow runs of octo/repo");
  progress.plan(2, "run artifacts to fetch (34 KiB)");
  progress.fetching(1, 2, "testfile-run (workflow run 7)");
  progress.fetched(1, 2, "testfile-run (workflow run 7)", 2, 0);
  progress.fetching(2, 2, "testfile-run-merged (workflow run 7)");
  progress.fetched(2, 2, "testfile-run-merged (workflow run 7)", 0, 1);
  assert.deepEqual(stream.chunks, [
    "listing the last 2 workflow runs of octo/repo\n",
    "2 run artifacts to fetch (34 KiB)\n",
    "[1/2] testfile-run (workflow run 7) ...\n",
    "[1/2] testfile-run (workflow run 7) - 2 imported\n",
    "[2/2] testfile-run-merged (workflow run 7) ...\n",
    "[2/2] testfile-run-merged (workflow run 7) - 1 already known\n",
  ]);
});

test("a TTY updates the in-flight line in place", () => {
  const esc = String.fromCharCode(27);
  const stream = recorder(true);
  const progress = lineProgress(stream);
  progress.fetching(1, 3, "artifact");
  progress.fetched(1, 3, "artifact", 0, 0);
  assert.deepEqual(stream.chunks, [
    `\r${esc}[2K[1/3] artifact ...`,
    `\r${esc}[2K[1/3] artifact - nothing new\n`,
  ]);
});

test("an empty plan says so instead of counting to zero", () => {
  const stream = recorder(false);
  lineProgress(stream).plan(0, "run artifacts to fetch");
  assert.deepEqual(stream.chunks, ["nothing to fetch - run artifacts to fetch\n"]);
});
