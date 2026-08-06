import assert from "node:assert/strict";
import { test } from "node:test";
import { parseLabels, parseVariants } from "./run.js";

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

test("parseLabels trims, drops empties and keeps the first of a duplicate", () => {
  assert.deepEqual(parseLabels(["branch=main", "nightly"]), ["branch=main", "nightly"]);
  assert.deepEqual(parseLabels([]), []);
  assert.deepEqual(parseLabels(["  spaced  "]), ["spaced"]);
  assert.deepEqual(parseLabels(["", "   "]), [], "a label has to say something");
  assert.deepEqual(parseLabels(["a", "b", "a", " a "]), ["a", "b"], "in the order first given");
  // a label is free-form: no key=value shape is required or parsed
  assert.deepEqual(parseLabels(["release candidate", "=", "pr=42"]), [
    "release candidate",
    "=",
    "pr=42",
  ]);
});
