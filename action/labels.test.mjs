import assert from "node:assert/strict";
import { test } from "node:test";
import { githubLabels, inputLabels, runLabels } from "./labels.mjs";

// What GitHub sets for a push to a branch; the other cases override parts.
const push = {
  GITHUB_EVENT_NAME: "push",
  GITHUB_REF: "refs/heads/main",
  GITHUB_REF_NAME: "main",
  GITHUB_REF_TYPE: "branch",
  GITHUB_ACTOR: "octocat",
  GITHUB_REPOSITORY: "acme/app",
  GITHUB_WORKFLOW: "CI",
  GITHUB_JOB: "test",
  GITHUB_SHA: "0123456789abcdef0123456789abcdef01234567",
  GITHUB_RUN_ID: "42",
  RUNNER_OS: "Linux",
};

test("a push is labelled with its branch and who pushed it", () => {
  assert.deepEqual(githubLabels(push), [
    "trigger=push",
    "branch=main",
    "actor=octocat",
    "repo=acme/app",
    "workflow=CI",
    "job=test",
    "os=Linux",
    "sha=0123456",
    "ci-run=42",
  ]);
});

test("a pull request is labelled with both branches, its number and the actor", () => {
  const labels = githubLabels({
    ...push,
    GITHUB_EVENT_NAME: "pull_request",
    GITHUB_REF: "refs/pull/7/merge",
    GITHUB_REF_NAME: "7/merge",
    GITHUB_HEAD_REF: "feature/labels",
    GITHUB_BASE_REF: "main",
  });
  assert.ok(
    labels.includes("branch=feature/labels"),
    "the branch being proposed, not the merge ref",
  );
  assert.ok(labels.includes("base=main"));
  assert.ok(labels.includes("pr=7"));
  assert.ok(labels.includes("actor=octocat"));
  assert.ok(!labels.some((label) => label.startsWith("tag=")));

  // pull_request_target carries the same fields
  assert.ok(
    githubLabels({
      ...push,
      GITHUB_EVENT_NAME: "pull_request_target",
      GITHUB_REF: "refs/pull/9/merge",
      GITHUB_HEAD_REF: "hotfix",
      GITHUB_BASE_REF: "release",
    }).includes("pr=9"),
  );
});

test("a manual run and a nightly say so in plain words", () => {
  const manual = githubLabels({
    ...push,
    GITHUB_EVENT_NAME: "workflow_dispatch",
    GITHUB_REF_NAME: "release/2.0",
  });
  assert.ok(manual.includes("trigger=manual"));
  assert.ok(manual.includes("branch=release/2.0"), "the branch it was started on");

  const nightly = githubLabels({ ...push, GITHUB_EVENT_NAME: "schedule" });
  assert.ok(nightly.includes("trigger=schedule"));
  assert.ok(nightly.includes("branch=main"));

  // an event without a friendlier name keeps GitHub's own
  assert.ok(githubLabels({ ...push, GITHUB_EVENT_NAME: "release" }).includes("trigger=release"));
});

test("a tag build is labelled with the tag instead of a branch", () => {
  const labels = githubLabels({
    ...push,
    GITHUB_REF: "refs/tags/v2.0.0",
    GITHUB_REF_NAME: "v2.0.0",
    GITHUB_REF_TYPE: "tag",
  });
  assert.ok(labels.includes("tag=v2.0.0"));
  assert.ok(!labels.some((label) => label.startsWith("branch=")));
});

test("nothing the environment does not provide is recorded", () => {
  assert.deepEqual(githubLabels({}), []);
  assert.deepEqual(githubLabels({ GITHUB_ACTOR: "   ", GITHUB_REF_NAME: "" }), []);
  // a pull request without a resolvable number still labels its branches
  assert.deepEqual(
    githubLabels({
      GITHUB_EVENT_NAME: "pull_request",
      GITHUB_HEAD_REF: "feature",
      GITHUB_BASE_REF: "main",
    }),
    ["trigger=pull_request", "branch=feature", "base=main"],
  );
});

test("the labels input takes commas and newlines", () => {
  assert.deepEqual(inputLabels("nightly, slow\n  release  "), ["nightly", "slow", "release"]);
  assert.deepEqual(inputLabels(""), []);
  assert.deepEqual(inputLabels(undefined), []);
});

test("automatic labels come first, and nothing is recorded twice", () => {
  const labels = runLabels({ env: push, input: "nightly, branch=main" });
  assert.equal(labels[0], "trigger=push");
  assert.ok(labels.includes("nightly"));
  assert.equal(labels.filter((label) => label === "branch=main").length, 1);

  // the automatic set can be turned off
  assert.deepEqual(runLabels({ env: push, input: "nightly", auto: false }), ["nightly"]);
  assert.deepEqual(runLabels({ env: {}, input: "" }), []);
});
