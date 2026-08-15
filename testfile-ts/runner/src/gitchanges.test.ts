import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  collectGitChanges,
  describeMatches,
  groupByPattern,
  matchChangedInputs,
  matchesPathPattern,
} from "./gitchanges.js";

function tempRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "testfile-git-"));
  process.on("exit", () => rmSync(dir, { recursive: true, force: true }));
  const git = (...args: string[]) => execFileSync("git", args, { cwd: dir, stdio: "pipe" });
  git("init", "-q", "-b", "main");
  git("config", "user.email", "test@example.invalid");
  git("config", "user.name", "test");
  git("config", "commit.gpgsign", "false");
  return dir;
}

function git(dir: string, ...args: string[]): void {
  execFileSync("git", args, { cwd: dir, stdio: "pipe" });
}

test("matchesPathPattern globbing", () => {
  assert.ok(matchesPathPattern("src/a.ts", "src/**/*.ts"), "** matches zero directories");
  assert.ok(matchesPathPattern("src/x/y/a.ts", "src/**/*.ts"), "** crosses directories");
  assert.ok(!matchesPathPattern("src/a.js", "src/**/*.ts"));
  assert.ok(matchesPathPattern("package.json", "package.json"));
  assert.ok(!matchesPathPattern("sub/package.json", "package.json"), "* stays in one segment");
  assert.ok(matchesPathPattern("sub/package.json", "**/package.json"));
  assert.ok(matchesPathPattern("a/b", "a/?"), "? matches one char");
  assert.ok(!matchesPathPattern("a/bc", "a/?"));
  assert.ok(matchesPathPattern("a.b.ts", "*.b.ts"), "dots are literal");
  assert.ok(!matchesPathPattern("aXbYts", "*.b.ts"));
});

test("groupByPattern counts each file once, under the first matching pattern", () => {
  const groups = groupByPattern(
    ["src/a.ts", "src/b.ts", "package.json", "README.md"],
    ["src/**/*.ts", "**/*.ts", "package.json"],
  );
  assert.deepEqual(groups, [
    { pattern: "src/**/*.ts", files: ["src/a.ts", "src/b.ts"] },
    { pattern: "package.json", files: ["package.json"] },
  ]);
});

test("describeMatches lists names only for small sets", () => {
  assert.equal(
    describeMatches([{ pattern: "src/**", files: ["a", "b"] }]),
    "src/**: 2 changed files (a, b)",
  );
  assert.equal(
    describeMatches([{ pattern: "src/**", files: ["a", "b", "c", "d"] }]),
    "src/**: 4 changed files",
  );
});

test("collectGitChanges merges the base diff with local changes", () => {
  const dir = tempRepo();
  writeFileSync(join(dir, "committed.txt"), "v1");
  writeFileSync(join(dir, "edited.txt"), "v1");
  writeFileSync(join(dir, "deleted.txt"), "v1");
  git(dir, "add", ".");
  git(dir, "commit", "-q", "-m", "base");
  git(dir, "checkout", "-q", "-b", "feature");
  writeFileSync(join(dir, "committed.txt"), "v2");
  writeFileSync(join(dir, "added.txt"), "new");
  git(dir, "add", ".");
  git(dir, "commit", "-q", "-m", "feature work");
  // local, uncommitted state on top
  writeFileSync(join(dir, "edited.txt"), "v2");
  writeFileSync(join(dir, "untracked.txt"), "who knows");
  rmSync(join(dir, "deleted.txt"));

  const changes = collectGitChanges(dir, "main");
  assert.equal(changes.baseRef, "main");
  assert.ok(changes.headCommit);
  assert.deepEqual(
    changes.files.map((file) => `${file.path} ${file.source} ${file.status}`),
    [
      "added.txt diff added",
      "committed.txt diff modified",
      "deleted.txt local deleted",
      "edited.txt local modified",
      "untracked.txt local untracked",
    ],
    "alphabetical, diff + local merged",
  );
});

test("collectGitChanges diffs from the merge base, not the base tip", () => {
  const dir = tempRepo();
  writeFileSync(join(dir, "shared.txt"), "v1");
  git(dir, "add", ".");
  git(dir, "commit", "-q", "-m", "base");
  git(dir, "checkout", "-q", "-b", "feature");
  writeFileSync(join(dir, "feature.txt"), "x");
  git(dir, "add", ".");
  git(dir, "commit", "-q", "-m", "feature");
  // the base branch moves on after the fork point
  git(dir, "checkout", "-q", "main");
  writeFileSync(join(dir, "main-only.txt"), "y");
  git(dir, "add", ".");
  git(dir, "commit", "-q", "-m", "main moves on");
  git(dir, "checkout", "-q", "feature");

  const changes = collectGitChanges(dir, "main");
  assert.deepEqual(
    changes.files.map((file) => file.path),
    ["feature.txt"],
    "commits that are only on the base branch don't count",
  );
});

test("collectGitChanges errors helpfully outside git or with a bad base", () => {
  const plain = mkdtempSync(join(tmpdir(), "testfile-nogit-"));
  process.on("exit", () => rmSync(plain, { recursive: true, force: true }));
  assert.throws(() => collectGitChanges(plain), /not inside a git repository/);

  const dir = tempRepo();
  writeFileSync(join(dir, "a.txt"), "x");
  git(dir, "add", ".");
  git(dir, "commit", "-q", "-m", "base");
  assert.throws(
    () => collectGitChanges(dir, "no-such-branch"),
    /cannot resolve base "no-such-branch"/,
  );
});

test("matchChangedInputs interprets patterns relative to the test's workdir", () => {
  const dir = mkdtempSync(join(tmpdir(), "testfile-match-"));
  process.on("exit", () => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, "pkg"), { recursive: true });
  const changes = {
    gitRoot: dir,
    baseRef: "origin/main",
    baseCommit: "abc",
    headCommit: "def",
    files: [
      { path: "pkg/src/a.ts", source: "diff" as const, status: "modified" as const },
      { path: "elsewhere/b.ts", source: "diff" as const, status: "modified" as const },
    ],
  };
  const matches = matchChangedInputs(changes, join(dir, "pkg"), ["src/**/*.ts"]);
  assert.deepEqual(matches, [{ pattern: "src/**/*.ts", files: ["src/a.ts"] }]);
  assert.deepEqual(
    matchChangedInputs(changes, join(dir, "pkg"), ["elsewhere/**"]),
    [],
    "files outside the workdir never match",
  );
});
