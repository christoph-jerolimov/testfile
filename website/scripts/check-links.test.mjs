import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { checkLinks, idsOf, linksOf, REPO_BLOB_URL } from "./check-links.mjs";

// Builds a dist/-like tree: { "docs/cli/index.html": "<html>" }.
function site(pages) {
  const dir = mkdtempSync(join(tmpdir(), "testfile-links-"));
  process.on("exit", () => rmSync(dir, { recursive: true, force: true }));
  for (const [path, html] of Object.entries(pages)) {
    mkdirSync(join(dir, dirname(path)), { recursive: true });
    writeFileSync(join(dir, path), html);
  }
  return dir;
}

test("links that resolve produce no problems", () => {
  const dir = site({
    "index.html": '<a href="/testfile/docs/cli">cli</a><img src="/testfile/logo.svg">',
    "docs/cli/index.html": '<h2 id="tags">Tags</h2><a href="/testfile/">home</a>',
    "logo.svg": "<svg></svg>",
  });
  assert.deepEqual(checkLinks(dir, { base: "/testfile" }), []);
});

test("a link to a page the build does not produce is reported", () => {
  const dir = site({ "index.html": '<a href="/testfile/docs/gone">gone</a>' });
  assert.deepEqual(checkLinks(dir, { base: "/testfile" }), [
    "/index.html: /testfile/docs/gone - no such page in dist/",
  ]);
});

test("a renamed heading breaks the anchors pointing at it", () => {
  const dir = site({
    "index.html": '<a href="/testfile/docs/cli#sharding">sharding</a>',
    "docs/cli/index.html": '<h2 id="sharding-across-machines">Sharding across machines</h2>',
  });
  assert.deepEqual(checkLinks(dir, { base: "/testfile" }), [
    '/index.html: /testfile/docs/cli#sharding - docs/cli/index.html has no "sharding" anchor',
  ]);
});

test("anchors within the same page are checked too", () => {
  const dir = site({ "docs/cli/index.html": '<a href="#tags">tags</a><h2 id="tag">Tag</h2>' });
  assert.equal(checkLinks(dir, { base: "/testfile" }).length, 1);
});

test("external links, mail links and data URIs are left alone", () => {
  const dir = site({
    "index.html":
      '<a href="https://github.com/christoph-jerolimov/testfile/blob/main/spec/README.md#x">spec</a>' +
      '<a href="mailto:nobody@example.com">mail</a><img src="data:image/gif;base64,R0lGOD">',
  });
  assert.deepEqual(checkLinks(dir, { base: "/testfile" }), []);
});

test("relative links resolve against the page they sit on", () => {
  const dir = site({
    "docs/cli/index.html": '<a href="../tags/">tags</a><a href="../missing/">missing</a>',
    "docs/tags/index.html": "<h1>Tags</h1>",
  });
  assert.deepEqual(checkLinks(dir, { base: "/testfile" }), [
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
  assert.deepEqual(checkLinks(dir, { base: "/testfile", repoRoot: join(dir, "repo") }), [
    `/index.html: ${REPO_BLOB_URL}schema/gone.json#L1 - no schema/gone.json in the repository`,
  ]);
  // without a repository to look in they stay external, like every other URL
  assert.deepEqual(checkLinks(dir, { base: "/testfile" }), []);
});

test("linksOf and idsOf read what the HTML declares", () => {
  assert.deepEqual(linksOf('<a href="/a">a</a><img src="/b.png">'), ["/a", "/b.png"]);
  assert.deepEqual([...idsOf('<h2 id="x">x</h2><a name="y"></a>')], ["x", "y"]);
});
