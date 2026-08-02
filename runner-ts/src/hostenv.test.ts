import assert from "node:assert/strict";
import { test } from "node:test";
import { baseEnv, forwardedEnv, matchesEnvPattern } from "./hostenv.js";

test("matchesEnvPattern: literals, prefix globs and *", () => {
  assert.ok(matchesEnvPattern("CI", "CI"));
  assert.ok(!matchesEnvPattern("CIRCLE", "CI"));
  assert.ok(matchesEnvPattern("GITHUB_TOKEN", "GITHUB_*"));
  assert.ok(matchesEnvPattern("GITHUB_", "GITHUB_*"));
  assert.ok(!matchesEnvPattern("GITLAB_TOKEN", "GITHUB_*"));
  assert.ok(matchesEnvPattern("ANYTHING", "*"));
  assert.ok(matchesEnvPattern("A_B_SUFFIX", "*_SUFFIX"));
  // regex metacharacters in names are literal
  assert.ok(!matchesEnvPattern("AXB", "A.B"));
});

test("forwardedEnv picks matching host vars only", () => {
  const host = { GITHUB_A: "1", GITHUB_B: "2", OTHER: "3", EMPTY: undefined };
  assert.deepEqual(forwardedEnv(["GITHUB_*"], host), { GITHUB_A: "1", GITHUB_B: "2" });
  assert.deepEqual(forwardedEnv(["OTHER", "GITHUB_B"], host), { GITHUB_B: "2", OTHER: "3" });
  assert.deepEqual(forwardedEnv([], host), {});
  assert.deepEqual(forwardedEnv(undefined, host), {});
});

test("baseEnv: essentials + runner defaults + forwarded, in that order", () => {
  const host = {
    PATH: "/bin",
    HOME: "/home/x",
    LC_ALL: "C",
    SECRET_TOKEN: "leak",
    CI: "false",
  };
  const clean = baseEnv(undefined, host);
  assert.equal(clean.PATH, "/bin");
  assert.equal(clean.HOME, "/home/x");
  assert.equal(clean.LC_ALL, "C");
  assert.equal(clean.SECRET_TOKEN, undefined, "unlisted host vars stay out");
  assert.equal(clean.CI, "1", "the runner provides CI=1");
  assert.equal(clean.FORCE_COLOR, "1");

  // forwarding wins over the runner defaults (explicit user intent)
  const forwarded = baseEnv(["CI", "SECRET_*"], host);
  assert.equal(forwarded.CI, "false");
  assert.equal(forwarded.SECRET_TOKEN, "leak");
});
