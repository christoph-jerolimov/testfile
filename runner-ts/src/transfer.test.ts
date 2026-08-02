import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { RunHistory, type RunMeta } from "./history.js";
import {
  githubRunArchives,
  importRunArchive,
  packRun,
  s3List,
  s3Pull,
  s3Push,
  syncFromGithub,
  type Exec,
} from "./transfer.js";

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "testfile-transfer-"));
  process.on("exit", () => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

const meta: RunMeta = {
  startedAtMs: Date.UTC(2026, 0, 1, 10, 0, 0),
  durationMs: 5,
  status: "passed",
  exitCode: 0,
  cancelled: false,
  env: {},
  ports: {},
  selected: ["all"],
};

function recordRun(baseDir: string): string {
  return new RunHistory(baseDir).saveRun(
    meta,
    [{ path: "all/one", status: "passed", durationMs: 3, lines: [{ text: "out", stream: "stdout" }] }],
    []
  ).id;
}

// A real exec for tar, recording (and faking) everything else.
function fakeAws(
  onCall: (command: string, args: string[]) => { status: number; stdout: string } | undefined
): { exec: Exec; calls: string[][] } {
  const calls: string[][] = [];
  const exec: Exec = (command, args) => {
    if (command === "tar" || command === "unzip") {
      const result = spawnSync(command, args, { encoding: "utf8" });
      return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
    }
    calls.push([command, ...args]);
    const faked = onCall(command, args);
    return { status: faked?.status ?? 0, stdout: faked?.stdout ?? "", stderr: "" };
  };
  return { exec, calls };
}

test("packRun and importRunArchive round-trip a run between histories", () => {
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

test("packRun rejects unknown runs, import rejects archives without runs", () => {
  const dir = tempDir();
  assert.throws(() => packRun(dir, "nope", join(dir, "x.tgz")), /no recorded run "nope"/);

  const stray = join(dir, "stray.tgz");
  spawnSync("sh", ["-c", `mkdir -p ${dir}/junk/sub && tar -czf ${stray} -C ${dir}/junk sub`]);
  assert.throws(() => importRunArchive(tempDir(), stray), /does not contain a recorded run/);
});

test("s3Push packs and uploads to <prefix>/<run-id>.tgz", () => {
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

test("s3List returns archives newest first, s3Pull imports the latest", () => {
  const source = tempDir();
  const id = recordRun(source);
  const prepared = join(tempDir(), `${id}.tgz`);
  packRun(source, id, prepared);

  const listing = [
    `2026-01-01 10:00:05        123 ${id}.tgz`,
    "2026-01-01 09:00:05        120 20251231-090000-aaaa.tgz",
    "", // trailing blank line
  ].join("\n");
  const { exec, calls } = fakeAws((command, args) => {
    if (args[1] === "ls") return { status: 0, stdout: listing };
    if (args[1] === "cp") {
      cpSync(prepared, args[3]); // "download" to the requested local file
      return { status: 0, stdout: "" };
    }
    return undefined;
  });

  assert.deepEqual(s3List("s3://bucket/runs", exec), [
    `${id}.tgz`,
    "20251231-090000-aaaa.tgz",
  ]);

  const target = tempDir();
  const result = s3Pull(target, "s3://bucket/runs", undefined, exec);
  assert.equal(result.archive, `${id}.tgz`);
  assert.deepEqual(result.imported, [id]);
  assert.equal(new RunHistory(target).runs[0]?.id, id);
  const cp = calls.find((call) => call[2] === "cp");
  assert.equal(cp?.[3], `s3://bucket/runs/${id}.tgz`);
});

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
          { id: 1, name: "testfile-run", archive_download_url: "https://dl/1" },
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
    { workflowRun: 11, workflowName: "CI", artifactId: 1, downloadUrl: "https://dl/1" },
  ]);
  assert.ok(requests.every((request) => request.auth === "Bearer tok"), "every call authenticates");
});

test("importRunArchive accepts a zip of the run folder's contents", () => {
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

test("syncFromGithub imports artifact zips holding the run contents directly", async () => {
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

test("syncFromGithub still imports legacy artifacts wrapping a .tgz", async () => {
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
