import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluateCondition } from "./condition.js";
import type { Scopes } from "./template.js";

const scopes: Scopes = {
  env: { CI: "true", EMPTY: "", OS: "linux", COUNT: "0" },
  ports: { web: 8080 },
  matrix: { db: "postgres" },
};

function evaluate(expression: string): boolean {
  return evaluateCondition(expression, scopes, "test");
}

test("truthiness of resolved values", () => {
  assert.equal(evaluate("${{ env.CI }}"), true);
  assert.equal(evaluate("${{ env.EMPTY }}"), false);
  assert.equal(evaluate("${{ env.COUNT }}"), false);
  assert.equal(evaluate("false"), false);
  assert.equal(evaluate("no"), false);
  assert.equal(evaluate("off"), false);
  assert.equal(evaluate("anything"), true);
});

test("unknown references resolve to empty (falsy) instead of throwing", () => {
  assert.equal(evaluate("${{ env.NOT_SET }}"), false);
  assert.equal(evaluate("${{ matrix.nope }}"), false);
});

test("equality and inequality comparison", () => {
  assert.equal(evaluate("${{ env.OS }} == linux"), true);
  assert.equal(evaluate("${{ env.OS }} == darwin"), false);
  assert.equal(evaluate("${{ env.OS }} != darwin"), true);
  assert.equal(evaluate("${{ matrix.db }} == postgres"), true);
  assert.equal(evaluate('"${{ env.OS }}" == "linux"'), true, "quotes are stripped");
  assert.equal(evaluate("${{ env.NOT_SET }} == ''"), true);
});

test("template defaults work inside conditions", () => {
  assert.equal(evaluate("${{ env.NOT_SET || yes }} == yes"), true);
  assert.equal(evaluate("${{ env.OS || fallback }} == linux"), true);
});

test("negation applies to the whole expression", () => {
  assert.equal(evaluate("!${{ env.CI }}"), false);
  assert.equal(evaluate("!${{ env.NOT_SET }}"), true);
  assert.equal(evaluate("!${{ env.OS }} == linux"), false);
  assert.equal(evaluate("!!${{ env.CI }}"), true);
});
