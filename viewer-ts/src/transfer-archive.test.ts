import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { needs } from "./testtools.js";
import { writeRun } from "./fixture.js";
import { RunHistory } from "./runrecord.js";
import { importRunArchive, packRun, type Exec } from "./transfer/index.js";

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "testfile-transfer-"));
  process.on("exit", () => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

let runCounter = 0;

function recordRun(baseDir: string): string {
  runCounter++;
  const stamp = String(runCounter).padStart(2, "0");
  return writeRun(
    baseDir,
    `202601${stamp}-100000-aaaa`,
    `2026-01-${stamp}T10:00:00.000Z`,
    [{ path: "all/one", status: "passed", durationMs: 3, log: "out\n" }]
  ).id;
}

// A real exec for tar, recording (and faking) everything else.
function fakeAws(
  onCall: (command: string, args: string[]) => { status: number; stdout: string } | undefined
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

test("packRun and importRunArchive round-trip a run between histories", { skip: needs("tar") }, () => {
  const source = tempDir();
  const id = recordRun(source);
  const archive = join(tempDir(), "run.tgz");
  packRun(source, id, archive);
  assert.ok(existsSync(archive));

  const target = tempDir();
  const first = importRunArchive(target, archive);
  assert.deepEqual(first, { imported: [id], skipped: [] });
  const history = new RunHistory(target);
  assert.equal(history.runs[0]?.id, id);
  assert.equal(history.readLog(history.runs[0], history.runs[0].tests[0]), "out\n");
  assert.equal(readFileSync(join(target, ".testfile", ".gitignore"), "utf8"), "*\n");

  // importing again leaves the local run untouched
  assert.deepEqual(importRunArchive(target, archive), { imported: [], skipped: [id] });
});

test("packRun rejects unknown runs, import rejects archives without runs", { skip: needs("sh", "tar") }, () => {
  const dir = tempDir();
  assert.throws(() => packRun(dir, "nope", join(dir, "x.tgz")), /no recorded run "nope"/);

  const stray = join(dir, "stray.tgz");
  spawnSync("sh", ["-c", `mkdir -p ${dir}/junk/sub && tar -czf ${stray} -C ${dir}/junk sub`]);
  assert.throws(() => importRunArchive(tempDir(), stray), /does not contain a recorded run/);
});

test("importRunArchive accepts a zip of the run folder's contents", { skip: needs("zip", "unzip") }, () => {
  const source = tempDir();
  const id = recordRun(source);
  const staging = tempDir();
  // the layout of a GitHub artifact: run.yaml and the logs at the zip root
  spawnSync("zip", ["-q", "-r", join(staging, "artifact.zip"), "."], {
    cwd: join(source, ".testfile", "runs", id),
  });

  const target = tempDir();
  assert.deepEqual(importRunArchive(target, join(staging, "artifact.zip")), {
    imported: [id],
    skipped: [],
  });
  const history = new RunHistory(target);
  assert.equal(history.runs[0]?.id, id);
  assert.equal(history.readLog(history.runs[0], history.runs[0].tests[0]), "out\n");
});
