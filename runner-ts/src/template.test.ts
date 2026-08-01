import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveEnvMap, resolveTemplate, type Scopes } from "./template.js";

const scopes: Scopes = {
  env: { HOME: "/home/u", NAME: "world" },
  ports: { web: 8080 },
  matrix: { node: "22" },
};

test("resolves all scopes", () => {
  assert.equal(
    resolveTemplate("http://localhost:${{ ports.web }}/${{ env.NAME }}-${{ matrix.node }}", scopes, "t"),
    "http://localhost:8080/world-22"
  );
});

test("leaves plain strings alone", () => {
  assert.equal(resolveTemplate("no templates here", scopes, "t"), "no templates here");
});

test("throws on unknown scope and unknown name", () => {
  assert.throws(() => resolveTemplate("${{ nope.x }}", scopes, "t"), /unknown template scope/);
  assert.throws(() => resolveTemplate("${{ ports.db }}", scopes, "t"), /"ports\.db" is not defined/);
});

test("|| supplies a default for undefined or empty references", () => {
  const withEmpty: Scopes = { ...scopes, env: { ...scopes.env, EMPTY: "" } };
  assert.equal(resolveTemplate("${{ env.MISSING || fallback }}", withEmpty, "t"), "fallback");
  assert.equal(resolveTemplate("${{ env.EMPTY || fallback }}", withEmpty, "t"), "fallback");
  assert.equal(resolveTemplate("${{ env.NAME || fallback }}", withEmpty, "t"), "world");
  assert.equal(resolveTemplate("${{ ports.db || 5432 }}", withEmpty, "t"), "5432");
  assert.equal(resolveTemplate("${{ ports.web || 5432 }}", withEmpty, "t"), "8080");
  assert.equal(
    resolveTemplate("${{ env.MISSING || 'quoted value' }}", withEmpty, "t"),
    "quoted value"
  );
  assert.equal(resolveTemplate("x=${{ env.MISSING || }}", withEmpty, "t"), "x=");
  // without a default, undefined references still error
  assert.throws(() => resolveTemplate("${{ env.MISSING }}", withEmpty, "t"), /not defined/);
});

test("resolveEnvMap coerces and resolves values", () => {
  const out = resolveEnvMap({ PORT: "${{ ports.web }}", DEBUG: true, RETRIES: 3 }, scopes, "t");
  assert.deepEqual(out, { PORT: "8080", DEBUG: "true", RETRIES: "3" });
});
