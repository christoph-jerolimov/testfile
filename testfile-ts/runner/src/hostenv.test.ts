import assert from "node:assert/strict";
import { test } from "node:test";
import { baseEnv, forwardedEnv, matchesEnvPattern, prefixedEnv } from "./hostenv.js";

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

test("prefixedEnv strips the prefix and collects what has to be masked", () => {
  const { env, secretValues } = prefixedEnv({
    TESTFILE_ENV_BASE_URL: "http://localhost:3000",
    TESTFILE_SECRET_TOKEN: "s3cr3t",
    TESTFILE_ENV_: "names nothing",
    TESTFILE_SECRET_BLANK: "",
    TESTFILE_ENGINE: "podman",
    PATH: "/bin",
    NOPE: undefined,
  });
  assert.deepEqual(env, {
    BASE_URL: "http://localhost:3000",
    TOKEN: "s3cr3t",
    BLANK: "",
  });
  assert.deepEqual(secretValues, ["s3cr3t"], "an empty value would mask everything");
});

test("a name given under both prefixes is the masked one", () => {
  const { env, secretValues } = prefixedEnv({
    TESTFILE_ENV_TOKEN: "plain",
    TESTFILE_SECRET_TOKEN: "masked",
  });
  assert.deepEqual(env, { TOKEN: "masked" });
  assert.deepEqual(secretValues, ["masked"]);
});

test("baseEnv: the prefixes need no forwardEnv and beat a pattern that also matches", () => {
  const host = {
    PATH: "/bin",
    CI: "false",
    TESTFILE_ENV_BASE_URL: "http://localhost:3000",
    TESTFILE_ENV_CI: "from-the-prefix",
  };
  const clean = baseEnv(undefined, host);
  assert.equal(clean.BASE_URL, "http://localhost:3000", "no forwardEnv needed");
  assert.equal(clean.CI, "from-the-prefix", "more deliberate than the runner default");
  assert.equal(clean.TESTFILE_ENV_BASE_URL, undefined, "the prefixed name itself stays out");

  // `forwardEnv: ["*"]` forwards TESTFILE_ENV_CI under its own name; the
  // stripped one still lands last.
  const everything = baseEnv(["*"], host);
  assert.equal(everything.CI, "from-the-prefix");
  assert.equal(everything.TESTFILE_ENV_CI, "from-the-prefix", "and the raw name comes along");
});
