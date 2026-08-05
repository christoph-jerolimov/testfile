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

export interface GithubArchive {
  workflowRun: number;
  workflowName: string;
  artifactId: number;
  downloadUrl: string;
  createdAt?: string;
  sizeBytes?: number;
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
    options,
  )) as { workflow_runs?: { id: number; name?: string; artifacts_url: string }[] };
  const archives: GithubArchive[] = [];
  for (const run of runs.workflow_runs ?? []) {
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
      if (artifact.name !== options.artifact || artifact.expired) continue;
      const entry: GithubArchive = {
        workflowRun: run.id,
        workflowName: run.name ?? "",
        artifactId: artifact.id,
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
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }
  return out;
}
