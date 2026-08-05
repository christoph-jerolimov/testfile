import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { needs } from "./testtools.js";
import { writeRun } from "./fixture.js";
import { RunHistory } from "./runrecord.js";
import { githubRunArchives, packRun, syncFromGithub } from "./transfer/index.js";

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

interface FakeResponseInit {
  json?: unknown;
  bytes?: Buffer;
  status?: number;
}

function fakeFetch(routes: Record<string, FakeResponseInit>): {
  fetchImpl: typeof fetch;
  requests: { url: string; auth?: string }[];
} {
  const requests: { url: string; auth?: string }[] = [];
  const fetchImpl = (async (input: unknown, init?: { headers?: Record<string, string> }) => {
    const url = String(input);
    requests.push({ url, auth: init?.headers?.authorization });
    const route = routes[url];
    if (!route) return { ok: false, status: 404, statusText: "Not Found" };
    return {
      ok: (route.status ?? 200) < 400,
      status: route.status ?? 200,
      statusText: "OK",
      json: async () => route.json,
      arrayBuffer: async () => {
        const bytes = route.bytes ?? Buffer.alloc(0);
        return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      },
    };
  }) as unknown as typeof fetch;
  return { fetchImpl, requests };
}

test("githubRunArchives lists matching, unexpired artifacts of recent runs", async () => {
  const { fetchImpl, requests } = fakeFetch({
    "https://api.github.com/repos/o/r/actions/runs?status=completed&per_page=2": {
      json: {
        workflow_runs: [
          { id: 11, name: "CI", artifacts_url: "https://api.github.com/runs/11/artifacts" },
          { id: 10, name: "CI", artifacts_url: "https://api.github.com/runs/10/artifacts" },
        ],
      },
    },
    "https://api.github.com/runs/11/artifacts": {
      json: {
        artifacts: [
          {
            id: 1,
            name: "testfile-run",
            archive_download_url: "https://dl/1",
            created_at: "2026-01-02T09:01:00Z",
            size_in_bytes: 15692,
          },
          { id: 2, name: "test-results", archive_download_url: "https://dl/2" },
        ],
      },
    },
    "https://api.github.com/runs/10/artifacts": {
      json: {
        artifacts: [{ id: 3, name: "testfile-run", archive_download_url: "https://dl/3", expired: true }],
      },
    },
  });

  const archives = await githubRunArchives({
    repo: "o/r",
    latest: 2,
    artifact: "testfile-run",
    token: "tok",
    fetchImpl,
  });
  assert.deepEqual(archives, [
    {
      workflowRun: 11,
      workflowName: "CI",
      artifactId: 1,
      downloadUrl: "https://dl/1",
      createdAt: "2026-01-02T09:01:00Z",
      sizeBytes: 15692,
    },
  ]);
  assert.ok(requests.every((request) => request.auth === "Bearer tok"), "every call authenticates");
});

test("syncFromGithub imports artifact zips holding the run contents directly", { skip: needs("zip", "unzip") }, async () => {
  const source = tempDir();
  const id = recordRun(source);
  const staging = tempDir();
  spawnSync("zip", ["-q", "-r", join(staging, "artifact.zip"), "."], {
    cwd: join(source, ".testfile", "runs", id),
  });
  const zipBytes = readFileSync(join(staging, "artifact.zip"));

  const { fetchImpl } = fakeFetch({
    "https://api.github.com/repos/o/r/actions/runs?status=completed&per_page=1": {
      json: {
        workflow_runs: [{ id: 7, name: "CI", artifacts_url: "https://api.github.com/runs/7/artifacts" }],
      },
    },
    "https://api.github.com/runs/7/artifacts": {
      json: { artifacts: [{ id: 9, name: "testfile-run", archive_download_url: "https://dl/9" }] },
    },
    "https://dl/9": { bytes: zipBytes },
  });

  const target = tempDir();
  const result = await syncFromGithub(target, {
    repo: "o/r",
    latest: 1,
    artifact: "testfile-run",
    token: "tok",
    fetchImpl,
  });
  assert.equal(result.archives, 1);
  assert.deepEqual(result.imported, [id]);
  assert.equal(new RunHistory(target).runs[0]?.id, id);

  // a second sync skips the already-imported run
  const again = await syncFromGithub(target, {
    repo: "o/r",
    latest: 1,
    artifact: "testfile-run",
    token: "tok",
    fetchImpl,
  });
  assert.deepEqual(again.skipped, [id]);
});

test("syncFromGithub still imports legacy artifacts wrapping a .tgz", { skip: needs("zip", "unzip", "tar") }, async () => {
  const source = tempDir();
  const id = recordRun(source);
  const staging = tempDir();
  packRun(source, id, join(staging, "testfile-run.tgz"));
  spawnSync("zip", ["-q", "-j", join(staging, "artifact.zip"), join(staging, "testfile-run.tgz")]);
  const zipBytes = readFileSync(join(staging, "artifact.zip"));

  const { fetchImpl } = fakeFetch({
    "https://api.github.com/repos/o/r/actions/runs?status=completed&per_page=1": {
      json: {
        workflow_runs: [{ id: 8, name: "CI", artifacts_url: "https://api.github.com/runs/8/artifacts" }],
      },
    },
    "https://api.github.com/runs/8/artifacts": {
      json: { artifacts: [{ id: 10, name: "testfile-run", archive_download_url: "https://dl/10" }] },
    },
    "https://dl/10": { bytes: zipBytes },
  });

  const target = tempDir();
  const result = await syncFromGithub(target, {
    repo: "o/r",
    latest: 1,
    artifact: "testfile-run",
    token: "tok",
    fetchImpl,
  });
  assert.deepEqual(result.imported, [id]);
});
