import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { needs } from "./testtools.js";
import { writeRun } from "@testfile/core/fixture";
import { RunHistory } from "@testfile/core";
import { packRun, s3List, s3Pull, s3Push, type Exec } from "./index.js";

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "testfile-transfer-"));
  process.on("exit", () => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

let runCounter = 0;

function recordRun(baseDir: string): string {
  runCounter++;
  const stamp = String(runCounter).padStart(2, "0");
  return writeRun(baseDir, `202601${stamp}-100000-aaaa`, `2026-01-${stamp}T10:00:00.000Z`, [
    { path: "all/one", status: "passed", durationMs: 3, log: "out\n" },
  ]).id;
}

// A real exec for tar, recording (and faking) everything else.
function fakeAws(
  onCall: (command: string, args: string[]) => { status: number; stdout: string } | undefined,
): { exec: Exec; calls: string[][] } {
  const calls: string[][] = [];
  const exec: Exec = (command, args, options) => {
    if (command === "tar" || command === "unzip") {
      const result = spawnSync(command, args, { encoding: "utf8", cwd: options?.cwd });
      return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
    }
    calls.push([command, ...args]);
    const faked = onCall(command, args);
    return { status: faked?.status ?? 0, stdout: faked?.stdout ?? "", stderr: "" };
  };
  return { exec, calls };
}

test("s3Push packs and uploads to <prefix>/<run-id>.tgz", { skip: needs("tar") }, () => {
  const dir = tempDir();
  const id = recordRun(dir);
  const { exec, calls } = fakeAws(() => undefined);
  const url = s3Push(dir, id, "s3://bucket/runs/", exec);
  assert.equal(url, `s3://bucket/runs/${id}.tgz`);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], "aws");
  assert.deepEqual(calls[0].slice(1, 3), ["s3", "cp"]);
  assert.equal(calls[0][4], url);
});

test(
  "s3List returns archives newest first, s3Pull imports the latest",
  { skip: needs("tar") },
  () => {
    const source = tempDir();
    const id = recordRun(source);
    const prepared = join(tempDir(), `${id}.tgz`);
    packRun(source, id, prepared);

    const listing = [
      `2026-01-01 10:00:05        123 ${id}.tgz`,
      "2026-01-01 09:00:05        120 20251231-090000-aaaa.tgz",
      "", // trailing blank line
    ].join("\n");
    const { exec, calls } = fakeAws((_command, args) => {
      if (args[1] === "ls") return { status: 0, stdout: listing };
      if (args[1] === "cp") {
        cpSync(prepared, args[3]); // "download" to the requested local file
        return { status: 0, stdout: "" };
      }
      return undefined;
    });

    assert.deepEqual(s3List("s3://bucket/runs", exec), [`${id}.tgz`, "20251231-090000-aaaa.tgz"]);

    const target = tempDir();
    const result = s3Pull(target, "s3://bucket/runs", undefined, exec);
    assert.equal(result.archive, `${id}.tgz`);
    assert.deepEqual(result.imported, [id]);
    assert.equal(new RunHistory(target).runs[0]?.id, id);
    const cp = calls.find((call) => call[2] === "cp");
    assert.equal(cp?.[3], `s3://bucket/runs/${id}.tgz`);
  },
);
