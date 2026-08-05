// Local run archives: pack a self-contained .testfile/runs/<id>/ folder as
// a .tgz and import such archives (or GitHub artifact zips) back into a
// history. Everything lands in the per-run layout the runner writes, so
// imported runs show up in `testfile-viewer runs` and the TUI like local
// ones. The S3 and GitHub backends build on these primitives.
import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "yaml";
import { HISTORY_DIR } from "../runrecord.js";

// Shell-out abstraction, injectable for tests.
export type Exec = (
  command: string,
  args: string[]
) => { status: number | null; stdout: string; stderr: string };

export const defaultExec: Exec = (command, args) => {
  const result = spawnSync(command, args, { encoding: "utf8" });
  if (result.error) {
    const code = (result.error as NodeJS.ErrnoException).code;
    throw new Error(
      code === "ENOENT"
        ? `"${command}" is not installed (needed for this command)`
        : result.error.message
    );
  }
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
};

function runsDir(baseDir: string): string {
  return join(baseDir, HISTORY_DIR, "runs");
}

// tar reads "C:\path" as host:path and tries to reach a machine called C,
// so every absolute path on Windows needs this. GNU tar (the one Git for
// Windows ships) understands it; on Linux and macOS it is not needed.
const tarLocal = process.platform === "win32" ? ["--force-local"] : [];

// Packs one recorded run (the whole runs/<id>/ folder) into a .tgz whose
// single top-level entry is the run id.
export function packRun(baseDir: string, runId: string, outFile: string, exec: Exec = defaultExec): void {
  const dir = join(runsDir(baseDir), runId);
  if (!existsSync(join(dir, "run.yaml"))) {
    throw new Error(`no recorded run "${runId}" in ${HISTORY_DIR}/runs/`);
  }
  const result = exec("tar", [...tarLocal, "-czf", outFile, "-C", runsDir(baseDir), runId]);
  if (result.status !== 0) {
    throw new Error(`tar failed: ${(result.stderr || result.stdout).trim()}`);
  }
}

export interface ImportResult {
  imported: string[];
  skipped: string[];
}

// Copies one extracted run folder into the local history (skipping runs
// that already exist locally, same id).
function importRunDir(baseDir: string, dir: string, id: string, out: ImportResult): void {
  const target = join(runsDir(baseDir), id);
  if (existsSync(target)) {
    out.skipped.push(id);
    return;
  }
  mkdirSync(runsDir(baseDir), { recursive: true });
  cpSync(dir, target, { recursive: true });
  writeFileSync(join(baseDir, HISTORY_DIR, ".gitignore"), "*\n");
  out.imported.push(id);
}

// Imports everything run-shaped found under an extraction directory:
// either run folders (<id>/run.yaml, the tgz layout) or a run's contents
// directly at the root (run.yaml next to the logs - the layout of a
// GitHub artifact zip, which wraps the uploaded folder's contents).
export function importExtracted(baseDir: string, tmp: string, out: ImportResult): void {
  // Archives nest differently depending on who made them: the run folder
  // itself (tgz), its contents at the root (GitHub artifacts), or the
  // declared paths .testfile/runs/<id>/ (GitLab, Jenkins, Buildkite). Walk
  // until a run.yaml turns up, but not into a run folder's own subfolders.
  const visit = (dir: string, depth: number): void => {
    const id = readRecordId(join(dir, "run.yaml"));
    if (id !== undefined) {
      importRunDir(baseDir, dir, id, out);
      return;
    }
    if (depth === 0) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) visit(join(dir, entry.name), depth - 1);
    }
  };
  visit(tmp, 4);
}

// The run id from a run.yaml, or undefined when the file is not a readable
// run record. Falls back to the folder name only when the record has no id.
function readRecordId(file: string): string | undefined {
  try {
    const record = parse(readFileSync(file, "utf8")) as { id?: string; tests?: unknown } | null;
    if (!record || !Array.isArray(record.tests)) return undefined;
    return record.id ?? undefined;
  } catch {
    return undefined;
  }
}

// Imports every run found in a .tgz or .zip archive into the local
// history. Runs that already exist locally (same id) are left untouched.
export function importRunArchive(
  baseDir: string,
  archive: string,
  exec: Exec = defaultExec
): ImportResult {
  const tmp = mkdtempSync(join(tmpdir(), "testfile-import-"));
  try {
    const result = archive.endsWith(".zip")
      ? exec("unzip", ["-o", "-q", archive, "-d", tmp])
      : exec("tar", [...tarLocal, "-xzf", archive, "-C", tmp]);
    if (result.status !== 0) {
      throw new Error(`extracting ${archive} failed: ${(result.stderr || result.stdout).trim()}`);
    }
    const out: ImportResult = { imported: [], skipped: [] };
    importExtracted(baseDir, tmp, out);
    if (out.imported.length === 0 && out.skipped.length === 0) {
      throw new Error(`${archive} does not contain a recorded run`);
    }
    return out;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

