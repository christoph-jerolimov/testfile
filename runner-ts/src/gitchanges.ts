import { spawnSync } from "node:child_process";
import { relative, resolve, sep } from "node:path";

// Git-based change detection: the files that differ between a base branch
// and the current commit, plus everything changed locally (staged, unstaged
// and untracked). This is what `--changed` selects tests from and what the
// `changes` command prints - it needs a git checkout, not a warm cache, so
// it works on CI runners that start from a fresh clone.

export interface ChangedFile {
  // Path relative to the git root, "/"-separated.
  path: string;
  // Whether the change comes from the base..HEAD diff or the working copy.
  source: "diff" | "local";
  status: "added" | "modified" | "deleted" | "renamed" | "copied" | "untracked";
}

export interface GitChanges {
  gitRoot: string;
  baseRef: string;
  baseCommit: string;
  headCommit?: string;
  // Alphabetical; a file that is both in the diff and locally modified
  // appears once, as "local".
  files: ChangedFile[];
}

function git(cwd: string, ...args: string[]): string | undefined {
  const proc = spawnSync("git", args, { cwd, encoding: "utf8" });
  return proc.status === 0 ? proc.stdout.replace(/\n$/, "") : undefined;
}

// The base branch to diff against when none is given: the remote's default
// branch when known, else the usual names.
function detectBaseRef(cwd: string): string | undefined {
  const symbolic = git(cwd, "symbolic-ref", "-q", "refs/remotes/origin/HEAD");
  if (symbolic) return symbolic.replace("refs/remotes/", "");
  for (const candidate of ["origin/main", "origin/master", "main", "master"]) {
    if (git(cwd, "rev-parse", "--verify", "-q", `${candidate}^{commit}`) !== undefined) {
      return candidate;
    }
  }
  return undefined;
}

export function collectGitChanges(dir: string, baseOverride?: string): GitChanges {
  const gitRoot = git(dir, "rev-parse", "--show-toplevel");
  if (gitRoot === undefined) {
    throw new Error(`${dir} is not inside a git repository (change detection needs git)`);
  }
  // Undefined on an unborn branch (no commits yet): the diff is then empty
  // and only local changes count.
  const headCommit = git(dir, "rev-parse", "--verify", "-q", "HEAD^{commit}") || undefined;

  let baseRef: string | undefined;
  if (baseOverride) {
    baseRef = [baseOverride, `origin/${baseOverride}`].find(
      (candidate) => git(dir, "rev-parse", "--verify", "-q", `${candidate}^{commit}`) !== undefined
    );
    if (!baseRef) {
      throw new Error(
        `cannot resolve base "${baseOverride}" (also tried "origin/${baseOverride}") - ` +
          `fetch it first, e.g. git fetch origin ${baseOverride}` +
          ` (on GitHub Actions use actions/checkout with fetch-depth: 0)`
      );
    }
  } else {
    baseRef = detectBaseRef(dir);
    if (!baseRef) {
      throw new Error(
        "cannot detect a base branch (tried origin/HEAD, origin/main, origin/master, main, master) - " +
          "pass one with --changed-since <ref>"
      );
    }
  }
  // Diff from the fork point, so commits that are only on the base branch
  // don't count as "changed" here.
  const baseCommit =
    (headCommit && git(dir, "merge-base", baseRef, headCommit)) ||
    git(dir, "rev-parse", `${baseRef}^{commit}`)!;

  const byPath = new Map<string, ChangedFile>();
  if (headCommit && baseCommit !== headCommit) {
    const diff = git(dir, "diff", "--name-status", "-M", baseCommit, headCommit) ?? "";
    for (const line of diff.split("\n")) {
      if (!line) continue;
      const [letter, ...paths] = line.split("\t");
      // Renames/copies list "old<TAB>new"; the new path is the changed one.
      const path = paths[paths.length - 1];
      byPath.set(path, { path, source: "diff", status: diffStatus(letter) });
    }
  }
  const porcelain = git(dir, "status", "--porcelain") ?? "";
  for (const line of porcelain.split("\n")) {
    if (!line) continue;
    const flags = line.slice(0, 2);
    const path = line.slice(3).replace(/^.* -> /, "").replace(/^"(.*)"$/, "$1");
    byPath.set(path, { path, source: "local", status: localStatus(flags) });
  }

  return {
    gitRoot,
    baseRef,
    baseCommit,
    headCommit,
    files: [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path)),
  };
}

function diffStatus(letter: string): ChangedFile["status"] {
  if (letter.startsWith("A")) return "added";
  if (letter.startsWith("D")) return "deleted";
  if (letter.startsWith("R")) return "renamed";
  if (letter.startsWith("C")) return "copied";
  return "modified";
}

function localStatus(flags: string): ChangedFile["status"] {
  if (flags === "??") return "untracked";
  if (flags.includes("D")) return "deleted";
  if (flags.includes("R")) return "renamed";
  if (flags.includes("A")) return "added";
  return "modified";
}

// Glob matching for repository paths: "**" crosses directory boundaries,
// "*" and "?" stay within one path segment (same semantics as `inputs`
// globbing at run time).
export function matchesPathPattern(path: string, pattern: string): boolean {
  let re = "";
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === "*") {
      if (pattern[i + 1] === "*") {
        if (pattern[i + 2] === "/") {
          re += "(?:[^/]+/)*";
          i += 2;
        } else {
          re += ".*";
          i += 1;
        }
      } else {
        re += "[^/]*";
      }
    } else if (ch === "?") {
      re += "[^/]";
    } else {
      re += ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`^${re}$`).test(path);
}

export interface PatternMatch {
  pattern: string;
  // Matched files, relative to the directory the patterns are relative to.
  files: string[];
}

// Groups files under the first pattern that matches each, so every file is
// counted once even when patterns overlap. Patterns with no match are absent.
export function groupByPattern(files: readonly string[], patterns: readonly string[]): PatternMatch[] {
  const groups = new Map<string, string[]>();
  for (const file of files) {
    const pattern = patterns.find((p) => matchesPathPattern(file, p));
    if (pattern === undefined) continue;
    const list = groups.get(pattern) ?? [];
    list.push(file);
    groups.set(pattern, list);
  }
  return [...groups.entries()].map(([pattern, matched]) => ({ pattern, files: matched.sort() }));
}

// The changed files that fall under a test's `inputs`, with the patterns
// interpreted relative to the test's working directory.
export function matchChangedInputs(
  changes: GitChanges,
  cwd: string,
  patterns: readonly string[]
): PatternMatch[] {
  const relativePaths: string[] = [];
  for (const file of changes.files) {
    const path = relative(cwd, resolve(changes.gitRoot, file.path)).split(sep).join("/");
    if (path.startsWith("../") || path === "" || path.startsWith("/")) continue;
    relativePaths.push(path);
  }
  return groupByPattern(relativePaths, patterns);
}

// "src/**/*.ts: 2 changed files (a.ts, b.ts)" - file names are listed only
// for small sets, counts always.
export function describeMatches(matches: readonly PatternMatch[]): string {
  return matches
    .map(({ pattern, files }) => {
      const count = `${files.length} changed file${files.length === 1 ? "" : "s"}`;
      return files.length < 4 ? `${pattern}: ${count} (${files.join(", ")})` : `${pattern}: ${count}`;
    })
    .join("; ");
}
