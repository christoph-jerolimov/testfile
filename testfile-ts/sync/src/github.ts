// Bringing the run artifacts of GitHub Actions workflow runs into a local
// history, through the GitHub REST API.
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  defaultExec,
  importExtracted,
  importRunArchive,
  type Exec,
  type ImportResult,
} from "./archive.js";
import { noProgress, type SyncProgress } from "./progress.js";

export interface GithubArchive {
  workflowRun: number;
  workflowName: string;
  artifactId: number;
  // The artifact's own name, e.g. testfile-run-ubuntu-latest.
  name: string;
  downloadUrl: string;
  createdAt?: string;
  sizeBytes?: number;
}

export interface GithubOptions {
  repo: string; // owner/repo
  latest: number; // how many recent workflow runs to consider
  // Artifact name the action uploads (default testfile-run). A matrix job
  // suffixes it per platform and the merge job adds "-merged", so this is a
  // prefix unless `exact` says otherwise.
  artifact: string;
  exact?: boolean;
  token: string;
  fetchImpl?: typeof fetch;
  apiBase?: string;
  // Narrates what the sync does while it works; silent when absent.
  progress?: SyncProgress;
}

// Whether an artifact of this name is one of ours.
export function artifactMatches(name: string, options: Pick<GithubOptions, "artifact" | "exact">) {
  return options.exact ? name === options.artifact : name.startsWith(options.artifact);
}

// GitHub caps a page at 100, so more than that takes several requests.
const MAX_PER_PAGE = 100;

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

// The latest n completed workflow runs, newest first.
async function recentRuns(
  options: GithubOptions,
): Promise<{ id: number; name?: string; artifacts_url: string }[]> {
  const base = options.apiBase ?? "https://api.github.com";
  const perPage = Math.min(options.latest, MAX_PER_PAGE);
  const runs: { id: number; name?: string; artifacts_url: string }[] = [];
  for (let page = 1; runs.length < options.latest; page++) {
    const body = (await githubApi(
      `${base}/repos/${options.repo}/actions/runs?status=completed&per_page=${perPage}&page=${page}`,
      options,
    )) as { workflow_runs?: { id: number; name?: string; artifacts_url: string }[] };
    const batch = body.workflow_runs ?? [];
    runs.push(...batch);
    if (batch.length < perPage) break; // the last page
  }
  return runs.slice(0, options.latest);
}

// The run artifacts of the latest n completed workflow runs, newest first.
export async function githubRunArchives(options: GithubOptions): Promise<GithubArchive[]> {
  const archives: GithubArchive[] = [];
  for (const run of await recentRuns(options)) {
    const artifacts = (await githubApi(run.artifacts_url, options)) as {
      artifacts?: {
        id: number;
        name: string;
        archive_download_url: string;
        expired?: boolean;
        created_at?: string;
        size_in_bytes?: number;
      }[];
    };
    for (const artifact of artifacts.artifacts ?? []) {
      if (!artifactMatches(artifact.name, options) || artifact.expired) continue;
      const entry: GithubArchive = {
        workflowRun: run.id,
        workflowName: run.name ?? "",
        artifactId: artifact.id,
        name: artifact.name,
        downloadUrl: artifact.archive_download_url,
      };
      if (artifact.created_at !== undefined) entry.createdAt = artifact.created_at;
      if (artifact.size_in_bytes !== undefined) entry.sizeBytes = artifact.size_in_bytes;
      archives.push(entry);
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
  exec: Exec = defaultExec,
): Promise<ImportResult & { archives: number }> {
  const doFetch = options.fetchImpl ?? fetch;
  const progress = options.progress ?? noProgress();
  progress.note(
    `listing the last ${options.latest} completed workflow run${options.latest === 1 ? "" : "s"} of ${options.repo}`,
  );
  const archives = await githubRunArchives(options);
  const bytes = archives.reduce((sum, archive) => sum + (archive.sizeBytes ?? 0), 0);
  progress.plan(
    archives.length,
    `run artifact${archives.length === 1 ? "" : "s"} to fetch${
      bytes > 0 ? ` (${Math.max(1, Math.round(bytes / 1024))} KiB)` : ""
    }`,
  );
  const out: ImportResult & { archives: number } = {
    archives: archives.length,
    imported: [],
    skipped: [],
  };
  for (const [at, archive] of archives.entries()) {
    const label = `${archive.name} (workflow run ${archive.workflowRun})`;
    progress.fetching(at + 1, archives.length, label);
    const before = { imported: out.imported.length, skipped: out.skipped.length };
    const response = await doFetch(archive.downloadUrl, {
      headers: { authorization: `Bearer ${options.token}`, "user-agent": "testfile-runner" },
      redirect: "follow",
    });
    if (!response.ok) {
      throw new Error(
        `downloading artifact ${archive.artifactId} failed: ${response.status} ${response.statusText}`,
      );
    }
    const tmp = mkdtempSync(join(tmpdir(), "testfile-sync-"));
    try {
      const zipFile = join(tmp, "artifact.zip");
      writeFileSync(zipFile, Buffer.from(await response.arrayBuffer()));
      const unzipped = join(tmp, "unzipped");
      const unzip = exec("unzip", ["-o", "-q", zipFile, "-d", unzipped]);
      if (unzip.status !== 0) {
        throw new Error(`unzip failed: ${(unzip.stderr || unzip.stdout).trim()}`);
      }
      // Current artifacts hold the run folder's contents directly; older
      // action versions packed a .tgz first - both import fine.
      const tgzArchives = readdirSync(unzipped).filter((entry) => entry.endsWith(".tgz"));
      if (tgzArchives.length > 0) {
        for (const entry of tgzArchives) {
          const result = importRunArchive(baseDir, join(unzipped, entry), exec);
          out.imported.push(...result.imported);
          out.skipped.push(...result.skipped);
        }
      } else {
        importExtracted(baseDir, unzipped, out);
      }
      progress.fetched(
        at + 1,
        archives.length,
        label,
        out.imported.length - before.imported,
        out.skipped.length - before.skipped,
      );
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }
  return out;
}
