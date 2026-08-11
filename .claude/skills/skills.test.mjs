// The skills tell an assistant which commands to run. A flag that quietly
// disappears would turn that advice into confident nonsense, so every
// command and flag a skill names is checked against the CLI's own --help.
//
// This is the same idea as the conformance coverage rule: a convention
// nobody enforces is a convention that drifts.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");

const BINARIES = {
  testfile: join(root, "runner-ts", "dist", "cli.js"),
  "testfile-viewer": join(root, "viewer-ts", "dist", "cli.js"),
};

function skills() {
  return readdirSync(here, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({
      dir: entry.name,
      text: readFileSync(join(here, entry.name, "SKILL.md"), "utf8"),
    }));
}

// The frontmatter block, as simple key: value pairs - enough to check the
// two fields a skill must have.
function frontmatter(text) {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(text);
  if (!match) return undefined;
  const fields = {};
  for (const line of match[1].split("\n")) {
    const at = line.indexOf(":");
    if (at > 0) fields[line.slice(0, at).trim()] = line.slice(at + 1).trim();
  }
  return fields;
}

// Every "testfile ..." / "testfile-viewer ..." invocation a skill shows,
// as {binary, subcommand, flags}. Only lines that start with a binary
// count, so prose mentioning a flag is not mistaken for a command.
function invocations(text) {
  const found = [];
  for (const raw of text.split("\n")) {
    const line = raw
      .trim()
      .replace(/^[-*|]\s*/, "")
      .replace(/^`|`$/g, "");
    const match = /^(testfile-viewer|testfile)\s+(.*)$/.exec(line);
    if (!match) continue;
    // stop at a pipe: what follows belongs to another program
    const args = match[2].split("|")[0].trim().split(/\s+/);
    const words = args.filter((word) => !word.startsWith("-"));
    const flags = args.filter((word) => /^--[a-z]/.test(word)).map((flag) => flag.split("=")[0]);
    // "inspect run <id>" nests: the flags belong to the innermost command,
    // so the path is every leading plain word, not just the first.
    const path = [];
    for (const word of words) {
      if (!/^[a-z][a-z0-9-]*$/.test(word)) break;
      path.push(word);
    }
    found.push({ binary: match[1], path, flags });
  }
  return found;
}

// The help of the deepest command that exists: a skill writes
// "testfile-viewer inspect run <id> --log", and --log is a flag of
// `inspect run`, not of `inspect`. Words that are arguments rather than
// subcommands are dropped by trying the longest path first.
function help(binary, path) {
  for (let depth = path.length; depth >= 0; depth--) {
    const result = spawnHelp(binary, path.slice(0, depth));
    if (result !== undefined) return result;
  }
  throw new Error(`${binary} refused even a bare --help`);
}

function spawnHelp(binary, path) {
  try {
    return execFileSync("node", [BINARIES[binary], ...path, "--help"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return undefined;
  }
}

test("every skill has the frontmatter that makes it findable", () => {
  const all = skills();
  assert.ok(all.length > 0, "no skills found");
  for (const skill of all) {
    const fields = frontmatter(skill.text);
    assert.ok(fields, `${skill.dir}: no frontmatter`);
    assert.equal(fields.name, skill.dir, `${skill.dir}: name must match the directory`);
    assert.ok(
      (fields.description ?? "").length > 40,
      `${skill.dir}: the description is what decides whether the skill is used`,
    );
  }
});

test("every command a skill tells an assistant to run exists", () => {
  for (const skill of skills()) {
    for (const call of invocations(skill.text)) {
      const first = call.path[0];
      if (first === undefined) continue;
      assert.match(
        help(call.binary, []),
        new RegExp(`^\\s+${first}\\b`, "m"),
        `${skill.dir}: ${call.binary} has no "${first}" command`,
      );
    }
  }
});

test("every flag a skill names is a flag the command has", () => {
  for (const skill of skills()) {
    for (const call of invocations(skill.text)) {
      if (call.flags.length === 0) continue;
      const text = help(call.binary, call.path);
      for (const flag of call.flags) {
        assert.ok(
          text.includes(flag),
          `${skill.dir}: ${call.binary} ${call.path.join(" ")} has no ${flag}`,
        );
      }
    }
  }
});
