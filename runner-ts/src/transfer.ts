// Moving recorded runs between machines: pack a self-contained
// .testfile/runs/<id>/ folder as a .tgz, import such archives into the
// local history, push/pull them to and from S3 (via the aws CLI) and sync
// the run artifacts of recent GitHub Actions workflow runs (via the GitHub
// API). Everything lands in the same per-run layout the runner writes, so
// imported runs show up in `testfile history` and the TUI like local ones.
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
import { HISTORY_DIR } from "./history.js";

// Shell-out abstraction, injectable for tests.
export type Exec = (
  command: string,
  args: string[]
) => { status: number | null; stdout: string; stderr: string };

const defaultExec: Exec = (command, args) => {
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

// Packs one recorded run (the whole runs/<id>/ folder) into a .tgz whose
// single top-level entry is the run id.
export function packRun(baseDir: string, runId: string, outFile: string, exec: Exec = defaultExec): void {
  const dir = join(runsDir(baseDir), runId);
  if (!existsSync(join(dir, "run.yaml"))) {
    throw new Error(`no recorded run "${runId}" in ${HISTORY_DIR}/runs/`);
  }
  const result = exec("tar", ["-czf", outFile, "-C", runsDir(baseDir), runId]);
  if (result.status !== 0) {
    throw new Error(`tar failed: ${(result.stderr || result.stdout).trim()}`);
  }
}

export interface ImportResult {
  imported: string[];
  skipped: string[];
}

// Imports every run found in a .tgz archive into the local history. Runs
// that already exist locally (same id) are left untouched.
export function importRunArchive(
  baseDir: string,
  archive: string,
  exec: Exec = defaultExec
): ImportResult {
  const tmp = mkdtempSync(join(tmpdir(), "testfile-import-"));
  try {
    const result = exec("tar", ["-xzf", archive, "-C", tmp]);
    if (result.status !== 0) {
      throw new Error(`tar failed: ${(result.stderr || result.stdout).trim()}`);
    }
    const out: ImportResult = { imported: [], skipped: [] };
    for (const entry of readdirSync(tmp, { withFileTypes: true })) {
      if (!entry.isDirectory() || !existsSync(join(tmp, entry.name, "run.yaml"))) continue;
      try {
        parse(readFileSync(join(tmp, entry.name, "run.yaml"), "utf8"));
      } catch {
        continue; // not a readable run record
      }
      const target = join(runsDir(baseDir), entry.name);
      if (existsSync(target)) {
        out.skipped.push(entry.name);
        continue;
      }
      mkdirSync(runsDir(baseDir), { recursive: true });
      cpSync(join(tmp, entry.name), target, { recursive: true });
      writeFileSync(join(baseDir, HISTORY_DIR, ".gitignore"), "*\n");
      out.imported.push(entry.name);
    }
    if (out.imported.length === 0 && out.skipped.length === 0) {
      throw new Error(`${archive} does not contain a recorded run`);
    }
    return out;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

function s3Url(prefix: string, name: string): string {
  return `${prefix.replace(/\/+$/, "")}/${name}`;
}

// Uploads one packed run to s3://bucket/prefix/<run-id>.tgz via the aws CLI.
export function s3Push(
  baseDir: string,
  runId: string,
  prefix: string,
  exec: Exec = defaultExec
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
  exec: Exec = defaultExec
): ImportResult & { archive: string } {
  const name = runId ? `${runId}.tgz` : s3List(prefix, exec)[0];
  if (!name) throw new Error(`no run archives found under ${prefix}`);
  const tmp = mkdtempSync(join(tmpdir(), "testfile-pull-"));
  try {
    const local = join(tmp, name);
    const url = s3Url(prefix, name);
    const result = exec("aws", ["s3", "cp", url, local]);
    if (result.status !== 0) {
      throw new Error(`aws s3 cp failed: ${(result.stderr || result.stdout).trim()}`);
    }
    return { archive: name, ...importRunArchive(baseDir, local, exec) };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

// --- GitHub Actions -------------------------------------------------------

export interface GithubArchive {
  workflowRun: number;
  workflowName: string;
  artifactId: number;
  downloadUrl: string;
}

export interface GithubOptions {
  repo: string; // owner/repo
  latest: number; // how many recent workflow runs to consider
  artifact: string; // artifact name the action uploads (default testfile-run)
  token: string;
  fetchImpl?: typeof fetch;
  apiBase?: string;
}

async function githubApi(url: string, options: GithubOptions): Promise<unknown> {
  const doFetch = options.fetchImpl ?? fetch;
  const response = await doFetch(url, {
    headers: {
      authorization: `Bearer ${options.token}`,
      accept: "application/vnd.github+json",
      "user-agent": "testfile-runner",
    },
  });
  if (!response.ok) {
    throw new Error(`GitHub API ${url} failed: ${response.status} ${response.statusText}`);
  }
  return response.json();
}

// The run artifacts of the latest n completed workflow runs, newest first.
export async function githubRunArchives(options: GithubOptions): Promise<GithubArchive[]> {
  const base = options.apiBase ?? "https://api.github.com";
  const runs = (await githubApi(
    `${base}/repos/${options.repo}/actions/runs?status=completed&per_page=${options.latest}`,
    options
  )) as { workflow_runs?: { id: number; name?: string; artifacts_url: string }[] };
  const archives: GithubArchive[] = [];
  for (const run of runs.workflow_runs ?? []) {
    const artifacts = (await githubApi(run.artifacts_url, options)) as {
      artifacts?: { id: number; name: string; archive_download_url: string; expired?: boolean }[];
    };
    for (const artifact of artifacts.artifacts ?? []) {
      if (artifact.name !== options.artifact || artifact.expired) continue;
      archives.push({
        workflowRun: run.id,
        workflowName: run.name ?? "",
        artifactId: artifact.id,
        downloadUrl: artifact.archive_download_url,
      });
    }
  }
  return archives;
}

// Downloads the artifact zips of recent workflow runs and imports every
// contained run archive. Artifacts are zip files (GitHub always wraps
// them), each holding the .tgz the action packed.
export async function syncFromGithub(
  baseDir: string,
  options: GithubOptions,
  exec: Exec = defaultExec
): Promise<ImportResult & { archives: number }> {
  const doFetch = options.fetchImpl ?? fetch;
  const archives = await githubRunArchives(options);
  const out: ImportResult & { archives: number } = {
    archives: archives.length,
    imported: [],
    skipped: [],
  };
  for (const archive of archives) {
    const response = await doFetch(archive.downloadUrl, {
      headers: { authorization: `Bearer ${options.token}`, "user-agent": "testfile-runner" },
      redirect: "follow",
    });
    if (!response.ok) {
      throw new Error(
        `downloading artifact ${archive.artifactId} failed: ${response.status} ${response.statusText}`
      );
    }
    const tmp = mkdtempSync(join(tmpdir(), "testfile-sync-"));
    try {
      const zipFile = join(tmp, "artifact.zip");
      writeFileSync(zipFile, Buffer.from(await response.arrayBuffer()));
      const unzip = exec("unzip", ["-o", "-q", zipFile, "-d", join(tmp, "unzipped")]);
      if (unzip.status !== 0) {
        throw new Error(`unzip failed: ${(unzip.stderr || unzip.stdout).trim()}`);
      }
      for (const entry of readdirSync(join(tmp, "unzipped"))) {
        if (!entry.endsWith(".tgz")) continue;
        const result = importRunArchive(baseDir, join(tmp, "unzipped", entry), exec);
        out.imported.push(...result.imported);
        out.skipped.push(...result.skipped);
      }
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }
  return out;
}
