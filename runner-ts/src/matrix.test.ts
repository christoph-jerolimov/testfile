import assert from "node:assert/strict";
import { test } from "node:test";
import { comboLabel, expandMatrix } from "./matrix.js";

test("cross product of two variables", () => {
  const combos = expandMatrix({ node: ["20", "22"], db: ["postgres", "mysql"] });
  assert.equal(combos.length, 4);
  assert.deepEqual(combos[0], { node: "20", db: "postgres" });
  assert.deepEqual(combos[3], { node: "22", db: "mysql" });
});

test("exclude removes matching combinations", () => {
  const combos = expandMatrix({
    node: ["20", "22"],
    db: ["postgres", "mysql"],
    exclude: [{ node: "20", db: "mysql" }],
  });
  assert.equal(combos.length, 3);
  assert.ok(!combos.some((c) => c.node === "20" && c.db === "mysql"));
});

test("include appends combinations", () => {
  const combos = expandMatrix({ node: ["20"], include: [{ node: "23", experimental: true }] });
  assert.equal(combos.length, 2);
  assert.deepEqual(combos[1], { node: "23", experimental: "true" });
});

test("numbers are stringified", () => {
  const combos = expandMatrix({ postgres: [15, 16] });
  assert.deepEqual(combos, [{ postgres: "15" }, { postgres: "16" }]);
});

test("comboLabel", () => {
  assert.equal(comboLabel({ node: "22", db: "pg" }), "node=22, db=pg");
});
