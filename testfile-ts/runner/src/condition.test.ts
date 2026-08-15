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

test("&& and || combine conditions, && binds tighter", () => {
  const scopes: Scopes = {
    env: { OS: "linux", CI: "", NAME: "my project" },
    ports: {},
    matrix: {},
  };
  const check = (expression: string) => evaluateCondition(expression, scopes, "test");

  assert.equal(check("${{ env.OS }} == linux && !${{ env.CI }}"), true);
  assert.equal(check("${{ env.OS }} == darwin && !${{ env.CI }}"), false);
  assert.equal(check("${{ env.OS }} == darwin || ${{ env.OS }} == linux"), true);
  assert.equal(check("${{ env.OS }} == darwin || ${{ env.OS }} == windows"), false);

  // && binds tighter: false && false || true  ->  (false && false) || true
  assert.equal(check("${{ env.CI }} && ${{ env.CI }} || ${{ env.OS }}"), true);
  // ... and parentheses override that
  assert.equal(check("${{ env.CI }} && (${{ env.CI }} || ${{ env.OS }})"), false);
  assert.equal(check("!(${{ env.OS }} == darwin || ${{ env.CI }})"), true);

  // operands keep their spaces
  assert.equal(check("${{ env.NAME }} == my project"), true);
  assert.equal(check("${{ env.NAME }} == my project && ${{ env.OS }} == linux"), true);
  // quoted values may contain the operators
  assert.equal(check('${{ env.NAME }} == "my project"'), true);
  assert.equal(check("'a && b' == 'a && b'"), true);
});

test("chained operators and empty operands behave", () => {
  const scopes: Scopes = { env: { A: "1", B: "", C: "yes" }, ports: {}, matrix: {} };
  const check = (expression: string) => evaluateCondition(expression, scopes, "test");
  assert.equal(check("${{ env.A }} && ${{ env.C }} && ${{ env.A }}"), true);
  assert.equal(check("${{ env.A }} && ${{ env.B }} && ${{ env.C }}"), false);
  assert.equal(check("${{ env.B }} || ${{ env.B }} || ${{ env.C }}"), true);
  // an unset variable on the left of != still compares
  assert.equal(check("${{ env.B }} != something"), true);
  assert.equal(check("${{ env.MISSING }} != ''"), false);
});
