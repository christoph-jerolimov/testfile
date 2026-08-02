import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { writeRun } from "./fixture.js";
import { ViewerServer } from "./serve.js";

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "testfile-viewer-serve-"));
  process.on("exit", () => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test("the REST API serves runs, logs and results on localhost", async () => {
  const dir = tempDir();
  const saved = writeRun(
    dir,
    "20260101-100000-aaaa",
    "2026-01-01T10:00:00.000Z",
    [
      { path: "all/good", status: "passed", durationMs: 1, log: "fine\n" },
      { path: "all/bad", status: "failed", durationMs: 2, log: "boom\n" },
    ],
    { status: "failed" }
  );

  const server = new ViewerServer({ baseDir: dir, port: 0, name: "demo" });
  const port = await server.start();
  const base = `http://127.0.0.1:${port}`;
  try {
    const summary = (await (await fetch(`${base}/api/summary`)).json()) as Record<string, unknown>;
    assert.equal(summary.name, "demo");
    assert.equal(summary.runs, 1);

    const runs = (await (await fetch(`${base}/api/runs`)).json()) as { runs: { id: string }[] };
    assert.equal(runs.runs[0].id, saved.id);

    const one = (await (await fetch(`${base}/api/runs/${saved.id}`)).json()) as { status: string };
    assert.equal(one.status, "failed");

    const log = await (await fetch(`${base}/api/runs/${saved.id}/log`)).text();
    assert.match(log, /=== all\/good \(passed/);
    const testLog = await (
      await fetch(`${base}/api/runs/${saved.id}/log?test=${encodeURIComponent("all/bad")}`)
    ).text();
    assert.equal(testLog, "boom\n");

    const results = (await (await fetch(`${base}/api/results`)).json()) as {
      tests: { path: string; fails: number }[];
    };
    assert.equal(results.tests.find((t) => t.path === "all/bad")?.fails, 1);

    assert.equal((await fetch(`${base}/api/runs/nope`)).status, 404);
    assert.equal((await fetch(`${base}/api/runs/..%2F..%2Fetc`)).status, 400);
    assert.equal((await fetch(`${base}/api/nothing`)).status, 404);

    // no viewer build configured: the fallback page still links the API
    const index = await (await fetch(`${base}/`)).text();
    assert.match(index, /REST API/);
  } finally {
    server.close();
  }
});

test("static files are served from the viewer dir, unknown paths fall back to index", async () => {
  const dir = tempDir();
  const viewerDir = join(dir, "viewer-dist");
  mkdirSync(viewerDir, { recursive: true });
  writeFileSync(join(viewerDir, "index.html"), "<html>viewer</html>");
  writeFileSync(join(viewerDir, "app.js"), "console.log(1)");

  const server = new ViewerServer({ baseDir: dir, port: 0, viewerDir });
  const port = await server.start();
  const base = `http://127.0.0.1:${port}`;
  try {
    assert.match(await (await fetch(`${base}/`)).text(), /viewer/);
    const js = await fetch(`${base}/app.js`);
    assert.match(js.headers.get("content-type") ?? "", /javascript/);
    // SPA fallback + traversal protection both land on index.html
    assert.match(await (await fetch(`${base}/some/route`)).text(), /viewer/);
    assert.match(await (await fetch(`${base}/..%2F..%2Fetc%2Fpasswd`)).text(), /viewer/);
  } finally {
    server.close();
  }
});
