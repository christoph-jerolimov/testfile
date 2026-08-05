import assert from "node:assert/strict";
import { test } from "node:test";
import { parseVariants } from "./run.js";

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
