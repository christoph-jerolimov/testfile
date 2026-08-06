import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { wantsJson, writeJson } from "./shared.js";

test("wantsJson tells a given flag from an absent one", () => {
  assert.equal(wantsJson(undefined), false);
  assert.equal(wantsJson(false), false);
  // `--json` on its own is `true`, `--json out.json` is the file name - and
  // an empty string would be a file name too, not an absent flag.
  assert.equal(wantsJson(true), true);
  assert.equal(wantsJson("out.json"), true);
  assert.equal(wantsJson(""), true);
});

test("writeJson writes a named file, and pretty-prints with a trailing newline", () => {
  const dir = mkdtempSync(join(tmpdir(), "testfile-"));
  try {
    const file = join(dir, "out.json");
    writeJson({ base: "a", compare: "b", fixed: ["ci/lint"] }, file);
    const text = readFileSync(file, "utf8");
    assert.ok(text.endsWith("\n"));
    assert.deepEqual(JSON.parse(text), { base: "a", compare: "b", fixed: ["ci/lint"] });
    assert.match(text, /\n  "base": "a"/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
