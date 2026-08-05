// Bringing the run artifacts of GitLab CI jobs into a local history,
// through the GitLab REST API. The mirror image of the GitHub backend:
// GitLab exposes job artifacts as a zip per job, which holds the run
// folder the pipeline archived.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  defaultExec,
  importExtracted,
  importRunArchive,
  type Exec,
  type ImportResult,
} from "./archive.js";

export interface GitlabArchive {
  pipeline: number;
  job: number;
  jobName: string;
  createdAt?: string;
  downloadUrl: string;
}

export interface GitlabOptions {
  // Project path ("group/project") or numeric id; encoded for the API.
  project: string;
  // How many recent pipelines to consider.
  latest: number;
  // Name of the job whose artifacts hold the run (default: "testfile").
  job: string;
  token: string;
  // Self-hosted instances: https://gitlab.example.com
  host?: string;
  ref?: string;
  fetchImpl?: typeof fetch;
}

function apiBase(options: GitlabOptions): string {
  const host = (options.host ?? "https://gitlab.com").replace(/\/+$/, "");
  return `${host}/api/v4/projects/${encodeURIComponent(options.project)}`;
}

async function gitlabApi(url: string, options: GitlabOptions): Promise<unknown> {
  const doFetch = options.fetchImpl ?? fetch;
  const response = await doFetch(url, {
    headers: { "private-token": options.token, "user-agent": "testfile-viewer" },
  });
  if (!response.ok) {
    throw new Error(`GitLab API ${url} failed: ${response.status} ${response.statusText}`);
  }
  return response.json();
}

// The artifact downloads of the matching job in the latest n pipelines,
// newest first.
export async function gitlabRunArchives(options: GitlabOptions): Promise<GitlabArchive[]> {
  const base = apiBase(options);
  const query = new URLSearchParams({
    per_page: String(options.latest),
    order_by: "id",
    sort: "desc",
  });
  if (options.ref) query.set("ref", options.ref);
  const pipelines = (await gitlabApi(`${base}/pipelines?${query}`, options)) as {
    id: number;
  }[];

  const archives: GitlabArchive[] = [];
  for (const pipeline of pipelines ?? []) {
    const jobs = (await gitlabApi(`${base}/pipelines/${pipeline.id}/jobs`, options)) as {
      id: number;
      name: string;
      created_at?: string;
      artifacts_file?: { filename?: string; size?: number };
    }[];
    for (const job of jobs ?? []) {
      if (job.name !== options.job || !job.artifacts_file) continue;
      archives.push({
        pipeline: pipeline.id,
        job: job.id,
        jobName: job.name,
        createdAt: job.created_at,
        downloadUrl: `${base}/jobs/${job.id}/artifacts`,
      });
    }
  }
  return archives;
}

// Downloads those artifact zips and imports every run they contain.
export async function syncFromGitlab(
  baseDir: string,
  options: GitlabOptions,
  exec: Exec = defaultExec,
): Promise<ImportResult & { archives: number }> {
  const doFetch = options.fetchImpl ?? fetch;
  const archives = await gitlabRunArchives(options);
  const out: ImportResult & { archives: number } = {
    archives: archives.length,
    imported: [],
    skipped: [],
  };
  for (const archive of archives) {
    const response = await doFetch(archive.downloadUrl, {
      headers: { "private-token": options.token, "user-agent": "testfile-viewer" },
      redirect: "follow",
    });
    if (!response.ok) {
      throw new Error(
        `downloading artifacts of job ${archive.job} failed: ${response.status} ${response.statusText}`,
      );
    }
    const tmp = mkdtempSync(join(tmpdir(), "testfile-gitlab-"));
    try {
      const zipFile = join(tmp, "artifacts.zip");
      writeFileSync(zipFile, Buffer.from(await response.arrayBuffer()));
      const unzipped = join(tmp, "unzipped");
      const unzip = exec("unzip", ["-o", "-q", zipFile, "-d", unzipped]);
      if (unzip.status !== 0) {
        throw new Error(`unzip failed: ${(unzip.stderr || unzip.stdout).trim()}`);
      }
      // A pipeline may archive the run folder itself or a packed .tgz.
      const { readdirSync } = await import("node:fs");
      const tgz = readdirSync(unzipped).filter((entry) => entry.endsWith(".tgz"));
      if (tgz.length > 0) {
        for (const entry of tgz) {
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
