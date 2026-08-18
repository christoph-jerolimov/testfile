import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { writeRun } from "@testfile.dev/core/fixture";
import { safeRelative, ViewerServer } from "./index.js";

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
    { status: "failed" },
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

test("safeRelative refuses anything that could leave the run folder", () => {
  assert.equal(safeRelative(["artifacts", "one", "report.txt"]), "artifacts/one/report.txt");
  assert.equal(safeRelative(["junit.xml"]), "junit.xml");
  // a space, and a name that only looks dangerous
  assert.equal(safeRelative(["my%20report..txt"]), "my report..txt");

  // a path has to name something
  assert.equal(safeRelative([]), undefined);
  assert.equal(safeRelative([""]), undefined);
  // "." and ".." in any of the spellings a request can carry
  for (const attempt of ["..", ".", "%2e%2e", "%2E%2E", "%2e"]) {
    assert.equal(safeRelative([attempt]), undefined, attempt);
  }
  // a separator smuggled into one segment, on either platform
  assert.equal(safeRelative(["..%2fsecret"]), undefined);
  assert.equal(safeRelative(["..%5csecret"]), undefined);
  assert.equal(safeRelative(["a", "..%2f..%2fetc%2fpasswd"]), undefined);
  // a NUL, and a broken escape
  assert.equal(safeRelative(["a%00b"]), undefined);
  assert.equal(safeRelative(["%zz"]), undefined);
});

test("a run's own files are served from its folder, and only from there", async () => {
  const dir = tempDir();
  const saved = writeRun(dir, "20260101-100000-bbbb", "2026-01-01T10:00:00.000Z", [
    { path: "all/one", status: "passed" },
  ]);
  const runDir = join(dir, ".testfile", "runs", saved.id);
  mkdirSync(join(runDir, "artifacts", "all-one"), { recursive: true });
  writeFileSync(join(runDir, "artifacts", "all-one", "report.txt"), "42 checks\n");
  writeFileSync(join(runDir, "junit.xml"), "<testsuites/>");
  writeFileSync(join(dir, ".testfile", "secret.txt"), "not yours");

  const server = new ViewerServer({ baseDir: dir, port: 0 });
  const port = await server.start();
  const base = `http://127.0.0.1:${port}/api/runs/${saved.id}/artifacts`;
  try {
    // the path is exactly what run.yaml records
    const report = await fetch(`${base}/artifacts/all-one/report.txt`);
    assert.equal(report.status, 200);
    assert.equal(await report.text(), "42 checks\n");
    assert.match(report.headers.get("content-type") ?? "", /text\/plain/);
    assert.equal(report.headers.get("x-content-type-options"), "nosniff");

    const junit = await fetch(`${base}/junit.xml`);
    assert.match(junit.headers.get("content-type") ?? "", /application\/xml/);
    assert.equal(await junit.text(), "<testsuites/>");

    // the record itself is in the folder, so it is served by the same route
    assert.match(await (await fetch(`${base}/run.yaml`)).text(), /20260101-100000-bbbb/);

    assert.equal((await fetch(`${base}/nothing.txt`)).status, 404);
    // the route needs a path; it is not a directory listing
    assert.equal((await fetch(`${base}`)).status, 400);
    assert.equal((await fetch(`${base}/`)).status, 400);
    // A traversal hidden inside a segment - the one shape a URL parser does
    // not resolve away before it reaches us. (A plain "../" never arrives:
    // the client resolves it, and the request lands on another route.)
    assert.equal((await fetch(`${base}/..%2fsecret.txt`)).status, 400);
    assert.equal((await fetch(`${base}/%00`)).status, 400);
    assert.equal((await fetch(`${base}/../secret.txt`)).status, 404);
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
