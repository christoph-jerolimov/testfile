import assert from "node:assert/strict";
import { test } from "node:test";
import {
  describe,
  leafTests,
  postStatuses,
  statusOf,
  statusesOf,
  targetSha,
  variantSuffix,
} from "./statuses.mjs";

// A run of a two-level suite: `ci` and `ci/checks` are the containers the
// runner records alongside the tests that actually ran a command.
const run = {
  variants: undefined,
  tests: [
    { path: "ci", status: "failed", durationMs: 5000 },
    { path: "ci/install", status: "passed", durationMs: 1500 },
    { path: "ci/checks", status: "failed", durationMs: 3000 },
    { path: "ci/checks/lint", status: "passed", durationMs: 900, cached: true },
    { path: "ci/checks/unit", status: "failed", durationMs: 2000 },
    { path: "ci/checks/e2e", status: "skipped" },
  ],
};

test("only the tests that ran get a status, not the groups around them", () => {
  assert.deepEqual(
    leafTests(run.tests).map((t) => t.path),
    ["ci/install", "ci/checks/lint", "ci/checks/unit", "ci/checks/e2e"],
  );
});

test("a single test without a group is a leaf", () => {
  assert.deepEqual(
    leafTests([{ path: "build", status: "passed" }]).map((t) => t.path),
    ["build"],
  );
});

test("the context is the test path behind the prefix", () => {
  assert.equal(
    statusOf({ path: "ci/checks/lint", status: "passed" }).context,
    "Testfile: ci/checks/lint",
  );
  assert.equal(
    statusOf({ path: "ci/lint", status: "passed" }, { prefix: "tests / " }).context,
    "tests / ci/lint",
  );
});

test("the variants of the run keep the legs of a matrix apart", () => {
  assert.equal(variantSuffix(undefined), "");
  assert.equal(variantSuffix({}), "");
  assert.equal(variantSuffix({ platform: "ubuntu-latest" }), " (platform=ubuntu-latest)");
  const [first] = statusesOf(
    { tests: [{ path: "ci/lint", status: "passed" }], variants: { platform: "macos-latest" } },
    {},
  );
  assert.equal(first.context, "Testfile: ci/lint (platform=macos-latest)");
});

test("every outcome maps to one of GitHub's four states", () => {
  const stateOf = (status) => statusOf({ path: "t", status }).state;
  assert.equal(stateOf("passed"), "success");
  assert.equal(stateOf("failed"), "failure");
  assert.equal(stateOf("aborted"), "error");
  // no neutral state exists; a required check must not hang on a skipped test
  assert.equal(stateOf("skipped"), "success");
  assert.equal(stateOf("something-new"), "error");
});

test("the description says how it went, how long it took and whether it was cached", () => {
  assert.equal(describe({ status: "passed", durationMs: 1500 }), "passed in 1.5s");
  assert.equal(
    describe({ status: "passed", durationMs: 12, cached: true }),
    "passed in 12ms (cached)",
  );
  assert.equal(describe({ status: "skipped" }), "skipped");
});

test("a context longer than GitHub accepts is cut short", () => {
  const status = statusOf({ path: "x".repeat(400), status: "passed" });
  assert.equal(status.context.length, 255);
  assert.ok(status.context.endsWith("…"));
});

test("the run's page is linked when the workflow run is known", () => {
  assert.equal(statusOf({ path: "t", status: "passed" }).target_url, undefined);
  assert.equal(
    statusOf({ path: "t", status: "passed" }, { targetUrl: "https://example.test/run/1" })
      .target_url,
    "https://example.test/run/1",
  );
});

test("a pull request is reported on its head, not on the merge commit", () => {
  const env = {
    GITHUB_EVENT_NAME: "pull_request",
    GITHUB_EVENT_PATH: "/event.json",
    GITHUB_SHA: "mergecommit",
  };
  assert.equal(
    targetSha(env, () => ({ pull_request: { head: { sha: "headcommit" } } })),
    "headcommit",
  );
  // no readable payload: the merge commit is better than nothing
  assert.equal(
    targetSha(env, () => undefined),
    "mergecommit",
  );
});

test("a push is reported on the commit that was pushed", () => {
  assert.equal(
    targetSha({ GITHUB_EVENT_NAME: "push", GITHUB_SHA: "abc" }, () => undefined),
    "abc",
  );
});

test("every status is posted to the commit", async () => {
  const posted = [];
  const result = await postStatuses(statusesOf(run, {}), {
    repo: "acme/app",
    sha: "abc123",
    token: "t0ken",
    apiBase: "https://api.test",
    fetchImpl: async (url, init) => {
      posted.push({ url, body: JSON.parse(init.body), auth: init.headers.authorization });
      return { ok: true, status: 201 };
    },
  });
  assert.equal(result.posted, 4);
  assert.equal(result.failed, 0);
  assert.equal(posted[0].url, "https://api.test/repos/acme/app/statuses/abc123");
  assert.equal(posted[0].auth, "Bearer t0ken");
  assert.deepEqual(
    posted.map((p) => p.body.context),
    [
      "Testfile: ci/install",
      "Testfile: ci/checks/lint",
      "Testfile: ci/checks/unit",
      "Testfile: ci/checks/e2e",
    ],
  );
});

test("a token that may not write statuses stops the batch instead of retrying it", async () => {
  let calls = 0;
  const result = await postStatuses(statusesOf(run, {}), {
    repo: "acme/app",
    sha: "abc123",
    token: "t0ken",
    fetchImpl: async () => {
      calls++;
      return { ok: false, status: 403, statusText: "Forbidden" };
    },
  });
  assert.equal(result.posted, 0);
  assert.equal(result.stopped, "403 Forbidden");
  // the four statuses are posted concurrently, so the batch stops after the
  // first answers - never after more than one round of workers
  assert.ok(calls <= 4, `expected the batch to stop early, made ${calls} calls`);
});

test("one failed status does not stop the others and does not throw", async () => {
  let calls = 0;
  const result = await postStatuses(statusesOf(run, {}), {
    repo: "acme/app",
    sha: "abc123",
    token: "t0ken",
    fetchImpl: async () => {
      calls++;
      if (calls === 1) throw new Error("socket hang up");
      return { ok: true, status: 201 };
    },
  });
  assert.equal(result.posted, 3);
  assert.equal(result.failed, 1);
  assert.equal(result.stopped, "");
});

test("a run without tests posts nothing", async () => {
  const result = await postStatuses(statusesOf({}, {}), {
    repo: "acme/app",
    sha: "abc",
    token: "t",
    fetchImpl: async () => assert.fail("nothing to post"),
  });
  assert.deepEqual(result, { posted: 0, failed: 0, stopped: "" });
});
