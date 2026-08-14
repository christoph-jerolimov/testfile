// The link checker, run the way the build runs it: as a command over a
// directory of built pages. Nothing here imports the checker - it is fed a
// site and judged by what it reports and the code it exits with, which is
// the part the CI job actually depends on.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const script = fileURLToPath(new URL("./check-links.js", import.meta.url));

// The links the markdown plugin writes for files that are not pages of the
// site. Spelled out rather than imported: if the plugin starts writing a
// different prefix, these tests should notice.
const REPO_BLOB_URL = "https://github.com/christoph-jerolimov/testfile/blob/main/";

// Builds a dist/-like tree: { "docs/cli/index.html": "<html>" }.
function site(pages: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "testfile-links-"));
  process.on("exit", () => rmSync(dir, { recursive: true, force: true }));
  for (const [path, html] of Object.entries(pages)) {
    mkdirSync(join(dir, dirname(path)), { recursive: true });
    writeFileSync(join(dir, path), html);
  }
  return dir;
}

// The reported broken links, and whether the run failed. The repository to
// resolve blob links against is always passed, and defaults to a directory
// that does not exist, so a test says which files the repository has.
function check(
  dir: string,
  { base = "/testfile", repoRoot }: { base?: string; repoRoot?: string } = {},
) {
  repoRoot ??= join(dir, "no-repo");
  const result = spawnSync(process.execPath, [script, dir, base, repoRoot], {
    encoding: "utf8",
  });
  return {
    failed: result.status !== 0,
    stdout: result.stdout.trim(),
    problems: result.stderr
      .split("\n")
      .filter((line) => line.startsWith("broken link "))
      .map((line) => line.slice("broken link ".length)),
  };
}

test("links that resolve are reported as such, and the run passes", () => {
  const dir = site({
    "index.html": '<a href="/testfile/docs/cli">cli</a><img src="/testfile/logo.svg">',
    "docs/cli/index.html": '<h2 id="tags">Tags</h2><a href="/testfile/">home</a>',
    "logo.svg": "<svg></svg>",
  });
  const result = check(dir);
  assert.deepEqual(result.problems, []);
  assert.equal(result.failed, false);
  assert.equal(result.stdout, "all links in 2 page(s) resolve");
});

test("a link to a page the build does not produce fails the run", () => {
  const result = check(site({ "index.html": '<a href="/testfile/docs/gone">gone</a>' }));
  assert.deepEqual(result.problems, ["/index.html: /testfile/docs/gone - no such page in dist/"]);
  assert.equal(result.failed, true);
});

test("a renamed heading breaks the anchors pointing at it", () => {
  const dir = site({
    "index.html": '<a href="/testfile/docs/cli#sharding">sharding</a>',
    "docs/cli/index.html": '<h2 id="sharding-across-machines">Sharding across machines</h2>',
  });
  assert.deepEqual(check(dir).problems, [
    '/index.html: /testfile/docs/cli#sharding - docs/cli/index.html has no "sharding" anchor',
  ]);
});

test("anchors within the same page are checked too", () => {
  const dir = site({ "docs/cli/index.html": '<a href="#tags">tags</a><h2 id="tag">Tag</h2>' });
  assert.equal(check(dir).problems.length, 1);
});

test("external links, mail links and data URIs are left alone", () => {
  const dir = site({
    "index.html":
      '<a href="https://example.com/somewhere#x">elsewhere</a>' +
      '<a href="mailto:nobody@example.com">mail</a><img src="data:image/gif;base64,R0lGOD">',
  });
  assert.deepEqual(check(dir).problems, []);
});

test("relative links resolve against the page they sit on", () => {
  const dir = site({
    "docs/cli/index.html": '<a href="../tags/">tags</a><a href="../missing/">missing</a>',
    "docs/tags/index.html": "<h1>Tags</h1>",
  });
  assert.deepEqual(check(dir).problems, [
    "/docs/cli/index.html: ../missing/ - no such page in dist/",
  ]);
});

test("links into the repository are resolved against the working copy", () => {
  const dir = site({
    "index.html":
      `<a href="${REPO_BLOB_URL}schema/testfile.schema.json">schema</a>` +
      `<a href="${REPO_BLOB_URL}schema/gone.json#L1">gone</a>`,
    "repo/schema/testfile.schema.json": "{}",
  });
  assert.deepEqual(check(dir, { repoRoot: join(dir, "repo") }).problems, [
    `/index.html: ${REPO_BLOB_URL}schema/gone.json#L1 - no schema/gone.json in the repository`,
  ]);
});

test("a directory with no built site says so instead of passing quietly", () => {
  const result = check(join(tmpdir(), "testfile-links-does-not-exist"));
  assert.equal(result.failed, true);
  assert.deepEqual(result.problems, []);
});
