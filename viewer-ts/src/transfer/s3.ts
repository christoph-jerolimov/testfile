// Sharing runs through an S3 bucket, using the aws CLI: push packs a run
// and uploads it, pull downloads one and imports it, list shows what is
// available under a prefix.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { importRunArchive, packRun, type Exec, type ImportResult } from "./archive.js";
import { defaultExec } from "./archive.js";
import { noProgress, type SyncProgress } from "./progress.js";

function s3Url(prefix: string, name: string): string {
  return `${prefix.replace(/\/+$/, "")}/${name}`;
}

// Uploads one packed run to s3://bucket/prefix/<run-id>.tgz via the aws CLI.
export function s3Push(
  baseDir: string,
  runId: string,
  prefix: string,
  exec: Exec = defaultExec,
): string {
  const tmp = mkdtempSync(join(tmpdir(), "testfile-push-"));
  try {
    const archive = join(tmp, `${runId}.tgz`);
    packRun(baseDir, runId, archive, exec);
    const url = s3Url(prefix, `${runId}.tgz`);
    const result = exec("aws", ["s3", "cp", archive, url]);
    if (result.status !== 0) {
      throw new Error(`aws s3 cp failed: ${(result.stderr || result.stdout).trim()}`);
    }
    return url;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

// Lists the run archives under an S3 prefix (newest first - run ids start
// with their UTC timestamp, so names sort chronologically).
export function s3List(prefix: string, exec: Exec = defaultExec): string[] {
  const result = exec("aws", ["s3", "ls", `${prefix.replace(/\/+$/, "")}/`]);
  if (result.status !== 0) {
    throw new Error(`aws s3 ls failed: ${(result.stderr || result.stdout).trim()}`);
  }
  return result.stdout
    .split("\n")
    .map((line) => line.trim().split(/\s+/).pop() ?? "")
    .filter((name) => name.endsWith(".tgz"))
    .sort()
    .reverse();
}

// Downloads a run archive from S3 and imports it. Without an explicit run
// id the newest archive under the prefix is taken.
export function s3Pull(
  baseDir: string,
  prefix: string,
  runId: string | undefined,
  exec: Exec = defaultExec,
  progress: SyncProgress = noProgress(),
): ImportResult & { archive: string } {
  if (!runId) progress.note(`listing run archives under ${prefix}`);
  const name = runId ? `${runId}.tgz` : s3List(prefix, exec)[0];
  if (!name) throw new Error(`no run archives found under ${prefix}`);
  progress.plan(1, `run archive to fetch`);
  const tmp = mkdtempSync(join(tmpdir(), "testfile-pull-"));
  try {
    const local = join(tmp, name);
    const url = s3Url(prefix, name);
    progress.fetching(1, 1, url);
    const result = exec("aws", ["s3", "cp", url, local]);
    if (result.status !== 0) {
      throw new Error(`aws s3 cp failed: ${(result.stderr || result.stdout).trim()}`);
    }
    const imported = importRunArchive(baseDir, local, exec);
    progress.fetched(1, 1, url, imported.imported.length, imported.skipped.length);
    return { archive: name, ...imported };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}
