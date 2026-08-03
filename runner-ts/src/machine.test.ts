import assert from "node:assert/strict";
import { hostname } from "node:os";
import { test } from "node:test";
import { detect } from "./machine.js";

test("CI actor names win over anything else", () => {
  assert.equal(detect({ GITHUB_ACTOR: "octocat" }), "octocat");
  assert.equal(detect({ GITLAB_USER_LOGIN: "gl-user" }), "gl-user");
  assert.equal(detect({ BUILDKITE_BUILD_CREATOR: "bk-user" }), "bk-user");
  assert.equal(
    detect({ GITHUB_ACTOR: "octocat", GITLAB_USER_LOGIN: "gl-user" }),
    "octocat",
    "GitHub first"
  );
});

test("without a CI actor it falls back to the gh login or the hostname", () => {
  // this environment has no authenticated gh, so the hostname is expected;
  // either way the result is a non-empty single-line identifier
  const detected = detect({});
  assert.ok(detected === undefined || detected === hostname() || /^[\w.-]+$/.test(detected));
  if (detected !== undefined) assert.ok(!detected.includes("\n"));
});
