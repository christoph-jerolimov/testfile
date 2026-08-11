import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { checkLlms, linkedPaths, pagesOf } from "./check-llms.mjs";

// Builds a dist/-like tree: { "docs/cli/index.html": "<html>", "llms.txt": "..." }.
function site(files) {
  const dir = mkdtempSync(join(tmpdir(), "testfile-llms-"));
  process.on("exit", () => rmSync(dir, { recursive: true, force: true }));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(dir, dirname(path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  return dir;
}

const SITE = "https://example.test/testfile";

function index(...paths) {
  return [
    "# Testfile",
    "",
    "> A declarative YAML format.",
    "",
    "## Documentation",
    "",
    ...paths.map((path) => `- [${path}](${SITE}${path}): what it says`),
    "",
  ].join("\n");
}

function full(...paths) {
  return paths.map((path) => `# page\n\nSource: ${SITE}${path}\n\nbody\n`).join("\n");
}

test("pages are the routes the build produced, not its assets", () => {
  const dir = site({
    "index.html": "<html>",
    "docs/cli/index.html": "<html>",
    "docs/matrix/index.html": "<html>",
    "logo.svg": "<svg></svg>",
    "llms.txt": "",
  });
  assert.deepEqual(pagesOf(dir), ["/", "/docs/cli", "/docs/matrix"]);
});

test("an index that covers every page is fine", () => {
  const dir = site({
    "index.html": "<html>",
    "docs/cli/index.html": "<html>",
    "llms.txt": index("/docs/cli"),
    "llms-full.txt": full("/docs/cli"),
  });
  assert.deepEqual(checkLlms(dir, { base: "/testfile" }), []);
});

test("a page the index forgot is reported: a partial index reads as a complete one", () => {
  const dir = site({
    "docs/cli/index.html": "<html>",
    "docs/matrix/index.html": "<html>",
    "llms.txt": index("/docs/cli"),
    "llms-full.txt": full("/docs/cli"),
  });
  assert.deepEqual(checkLlms(dir, { base: "/testfile" }), [
    "llms.txt: /docs/matrix is built but not indexed",
  ]);
});

test("a page named in the index but missing from the full text is reported", () => {
  const dir = site({
    "docs/cli/index.html": "<html>",
    "llms.txt": index("/docs/cli"),
    "llms-full.txt": full(),
  });
  assert.deepEqual(checkLlms(dir, { base: "/testfile" }), [
    "llms-full.txt: /docs/cli is indexed but its text is missing",
  ]);
});

test("the shape llms.txt promises is checked, not only its links", () => {
  const dir = site({
    "docs/cli/index.html": "<html>",
    "llms.txt": `- [/docs/cli](${SITE}/docs/cli): no title, no summary`,
    "llms-full.txt": full("/docs/cli"),
  });
  assert.deepEqual(checkLlms(dir, { base: "/testfile" }), [
    "llms.txt: no title heading",
    "llms.txt: no summary blockquote",
  ]);
});

test("a build without the files says so instead of passing quietly", () => {
  assert.deepEqual(checkLlms(site({ "index.html": "<html>" }), { base: "/testfile" }), [
    "llms.txt was not built",
  ]);
});

test("links to other sites are not paths of this one", () => {
  const found = linkedPaths(
    `- [repo](https://github.com/someone/testfile): the source\n- [cli](${SITE}/docs/cli): the CLI`,
    "/testfile",
  );
  assert.deepEqual([...found], ["/docs/cli"]);
});
