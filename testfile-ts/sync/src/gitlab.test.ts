import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { needs } from "./testtools.js";
import { writeRun } from "@testfile.dev/core/fixture";
import { RunHistory } from "@testfile.dev/core";
import { gitlabRunArchives, syncFromGitlab } from "./index.js";

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

interface FakeResponseInit {
  json?: unknown;
  bytes?: Buffer;
  status?: number;
}

function fakeFetch(routes: Record<string, FakeResponseInit>): {
  fetchImpl: typeof fetch;
  requests: { url: string; token?: string }[];
} {
  const requests: { url: string; token?: string }[] = [];
  const fetchImpl = (async (input: unknown, init?: { headers?: Record<string, string> }) => {
    const url = String(input);
    requests.push({ url, token: init?.headers?.["private-token"] });
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

test("gitlabRunArchives lists artifacts of the matching job in recent pipelines", async () => {
  const base = "https://gitlab.com/api/v4/projects/group%2Fproject";
  const { fetchImpl, requests } = fakeFetch({
    [`${base}/pipelines?per_page=2&order_by=id&sort=desc`]: { json: [{ id: 22 }, { id: 21 }] },
    [`${base}/pipelines/22/jobs`]: {
      json: [
        {
          id: 220,
          name: "testfile",
          created_at: "2026-02-01T10:00:00Z",
          artifacts_file: { filename: "artifacts.zip" },
        },
        { id: 221, name: "lint", artifacts_file: { filename: "artifacts.zip" } },
      ],
    },
    // no artifacts on this pipeline's job
    [`${base}/pipelines/21/jobs`]: { json: [{ id: 210, name: "testfile" }] },
  });

  const archives = await gitlabRunArchives({
    project: "group/project",
    latest: 2,
    job: "testfile",
    token: "tok",
    fetchImpl,
  });
  assert.deepEqual(archives, [
    {
      pipeline: 22,
      job: 220,
      jobName: "testfile",
      createdAt: "2026-02-01T10:00:00Z",
      downloadUrl: `${base}/jobs/220/artifacts`,
    },
  ]);
  assert.ok(
    requests.every((request) => request.token === "tok"),
    "every call sends the private token",
  );
});

test(
  "syncFromGitlab imports the run folder from a job artifact zip",
  { skip: needs("zip", "unzip") },
  async () => {
    const source = tempDir();
    const id = recordRun(source);
    const staging = tempDir();
    // GitLab archives the paths as declared, so the zip holds .testfile/runs/<id>/
    // (zip runs in the source with a relative path, no shell involved)
    spawnSync("zip", ["-q", "-r", join(staging, "artifacts.zip"), `.testfile/runs/${id}`], {
      cwd: source,
    });
    const zipBytes = readFileSync(join(staging, "artifacts.zip"));

    const base = "https://gitlab.example.com/api/v4/projects/17";
    const { fetchImpl } = fakeFetch({
      [`${base}/pipelines?per_page=1&order_by=id&sort=desc`]: { json: [{ id: 5 }] },
      [`${base}/pipelines/5/jobs`]: {
        json: [{ id: 50, name: "testfile", artifacts_file: { filename: "artifacts.zip" } }],
      },
      [`${base}/jobs/50/artifacts`]: { bytes: zipBytes },
    });

    const target = tempDir();
    const result = await syncFromGitlab(target, {
      project: "17",
      latest: 1,
      job: "testfile",
      token: "tok",
      host: "https://gitlab.example.com",
      fetchImpl,
    });
    assert.equal(result.archives, 1);
    assert.deepEqual(result.imported, [id]);
    assert.equal(new RunHistory(target).runs[0]?.id, id);
  },
);
