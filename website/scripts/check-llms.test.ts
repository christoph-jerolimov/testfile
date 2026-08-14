// The llms.txt checker, run the way the build runs it: as a command over a
// directory of built pages. Nothing here imports it - it is fed a site and
// judged by what it reports and the code it exits with.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const script = fileURLToPath(new URL("./check-llms.js", import.meta.url));
const SITE = "https://example.test/testfile";

// Builds a dist/-like tree: { "docs/cli/index.html": "<html>", "llms.txt": "..." }.
function site(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "testfile-llms-"));
  process.on("exit", () => rmSync(dir, { recursive: true, force: true }));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(dir, dirname(path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  return dir;
}

function check(dir: string, base = "/testfile") {
  const result = spawnSync(process.execPath, [script, dir, base], { encoding: "utf8" });
  return {
    failed: result.status !== 0,
    stdout: result.stdout.trim(),
    problems: result.stderr.trim() === "" ? [] : result.stderr.trim().split("\n"),
  };
}

// An index in the shape llms.txt promises: a title, a summary, then links.
function index(...paths: string[]): string {
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

function full(...paths: string[]): string {
  return paths.map((path) => `# page\n\nSource: ${SITE}${path}\n\nbody\n`).join("\n");
}

test("an index that covers every page passes", () => {
  const dir = site({
    "index.html": "<html>",
    "docs/cli/index.html": "<html>",
    "llms.txt": index("/docs/cli"),
    "llms-full.txt": full("/docs/cli"),
  });
  const result = check(dir);
  assert.deepEqual(result.problems, []);
  assert.equal(result.failed, false);
  assert.match(result.stdout, /indexes every page/);
});

test("a page the index forgot is reported: a partial index reads as a complete one", () => {
  const dir = site({
    "docs/cli/index.html": "<html>",
    "docs/matrix/index.html": "<html>",
    "llms.txt": index("/docs/cli"),
    "llms-full.txt": full("/docs/cli"),
  });
  const result = check(dir);
  assert.deepEqual(result.problems, ["llms.txt: /docs/matrix is built but not indexed"]);
  assert.equal(result.failed, true);
});

test("assets and the text files themselves are not pages an index must list", () => {
  const dir = site({
    "docs/cli/index.html": "<html>",
    "logo.svg": "<svg></svg>",
    "llms.txt": index("/docs/cli"),
    "llms-full.txt": full("/docs/cli"),
  });
  assert.deepEqual(check(dir).problems, []);
});

test("a page named in the index but missing from the full text is reported", () => {
  const dir = site({
    "docs/cli/index.html": "<html>",
    "llms.txt": index("/docs/cli"),
    "llms-full.txt": full(),
  });
  assert.deepEqual(check(dir).problems, [
    "llms-full.txt: /docs/cli is indexed but its text is missing",
  ]);
});

test("the shape llms.txt promises is checked, not only its links", () => {
  const dir = site({
    "docs/cli/index.html": "<html>",
    "llms.txt": `- [/docs/cli](${SITE}/docs/cli): no title, no summary`,
    "llms-full.txt": full("/docs/cli"),
  });
  assert.deepEqual(check(dir).problems, [
    "llms.txt: no title heading",
    "llms.txt: no summary blockquote",
  ]);
});

test("links to other sites are not pages of this one", () => {
  const dir = site({
    "docs/cli/index.html": "<html>",
    "llms.txt": index("/docs/cli").replace(
      "## Documentation",
      "## Documentation\n\n- [repo](https://github.com/someone/testfile): the source",
    ),
    "llms-full.txt": full("/docs/cli"),
  });
  assert.deepEqual(check(dir).problems, []);
});

test("a build without the files says so instead of passing quietly", () => {
  const result = check(site({ "index.html": "<html>" }));
  assert.deepEqual(result.problems, ["llms.txt was not built"]);
  assert.equal(result.failed, true);
});
