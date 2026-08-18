import assert from "node:assert/strict";
import { test } from "node:test";
import { parseLabels, parseVariants } from "./start.js";

test("parseVariants turns key=value pairs into a map", () => {
  assert.deepEqual(parseVariants(["platform=linux", "node=22"]), {
    platform: "linux",
    node: "22",
  });
  assert.deepEqual(parseVariants([]), {});
  // values may contain "=" and are trimmed
  assert.deepEqual(parseVariants([" shard = 1/2 ", "flags=--a=b"]), {
    shard: "1/2",
    flags: "--a=b",
  });
  assert.throws(() => parseVariants(["platform"]), /--variant expects key=value/);
  assert.throws(() => parseVariants(["=linux"]), /--variant expects key=value/);
});

test("parseLabels splits at the first = and refuses a repeated key", () => {
  assert.deepEqual(parseLabels(["branch=main", "pr=42"]), { branch: "main", pr: "42" });
  assert.deepEqual(parseLabels([]), {});
  // the value may contain "=", and both halves are trimmed
  assert.deepEqual(parseLabels([" note = a=b "]), { note: "a=b" });
  // an empty value is a value: "no branch" is worth recording as such
  assert.deepEqual(parseLabels(["branch="]), { branch: "" });

  assert.throws(() => parseLabels(["nightly"]), /--label expects key=value/);
  assert.throws(() => parseLabels(["=main"]), /--label expects key=value/);
  assert.throws(() => parseLabels(["  =main"]), /--label expects key=value/);
  assert.throws(
    () => parseLabels(["branch=main", "branch=other"]),
    /--label branch was given twice/,
  );
  assert.throws(() => parseLabels(["branch=main", " branch = main"]), /given twice/);
});
