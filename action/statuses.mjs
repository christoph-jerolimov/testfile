#!/usr/bin/env node
// Reports one GitHub commit status per test of the most recent recorded
// run, so a pull request says which tests passed instead of only whether
// the job did. Used by the composite action after `testfile start`; exits
// quietly when there is no run record (e.g. the Testfile failed validation).
//
//   node statuses.mjs <tested-path>
import { readFileSync } from "node:fs";
import { formatMs, latestRun } from "./record.mjs";

// A commit status is one of GitHub's four states. There is no neutral one -
// only check runs have that - so a skipped test reports success and says
// "skipped" in its description: a required check left pending forever would
// block the pull request over a test that was never meant to run.
const STATE = {
  passed: "success",
  failed: "failure",
  aborted: "error",
  skipped: "success",
};

// What the API accepts; longer values are rejected outright.
const MAX_CONTEXT = 255;
const MAX_DESCRIPTION = 140;

const clamp = (text, max) => (text.length <= max ? text : `${text.slice(0, max - 1)}…`);

// run.tests carries the containers (`ci`, `ci/checks`) alongside the tests
// inside them, and a container's result is just the aggregate of its
// children - which the job's own status already reports. Only leaves get a
// status, and a leaf is a path that no other path is nested under.
export function leafTests(tests = []) {
  const containers = new Set();
  for (const test of tests) {
    const parts = String(test.path ?? "").split("/");
    for (let i = 1; i < parts.length; i++) containers.add(parts.slice(0, i).join("/"));
  }
  return tests.filter((test) => !containers.has(test.path));
}

// What tells this run apart from a sibling run of the same suite. The legs
// of a workflow matrix all report on the same commit, so without the
// variant in the context the last leg to finish would silently overwrite
// what the others said.
export function variantSuffix(variants) {
  const pairs = Object.entries(variants ?? {}).map(([key, value]) => `${key}=${value}`);
  return pairs.length > 0 ? ` (${pairs.join(", ")})` : "";
}

// The status line itself: the outcome, how long it took, and whether the
// runner served it from the cache rather than running it.
export function describe(test) {
  const parts = [String(test.status)];
  if (typeof test.durationMs === "number") parts.push(`in ${formatMs(test.durationMs)}`);
  if (test.cached) parts.push("(cached)");
  return clamp(parts.join(" "), MAX_DESCRIPTION);
}

// One test as the REST API wants it.
export function statusOf(test, { prefix = "Testfile: ", variants, targetUrl } = {}) {
  return {
    context: clamp(`${prefix}${test.path}${variantSuffix(variants)}`, MAX_CONTEXT),
    state: STATE[test.status] ?? "error",
    description: describe(test),
    ...(targetUrl ? { target_url: targetUrl } : {}),
  };
}

export function statusesOf(run, options = {}) {
  return leafTests(run?.tests).map((test) =>
    statusOf(test, { ...options, variants: run?.variants }),
  );
}

function readEventPayload(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return undefined; // no event payload (or not readable); the fallback covers it
  }
}

// Which commit the statuses belong on. On a pull request GITHUB_SHA is the
// ephemeral merge commit, and a status there is shown nowhere - the head of
// the pull request is the commit people are looking at.
export function targetSha(env = process.env, readEvent = readEventPayload) {
  if ((env.GITHUB_EVENT_NAME ?? "").startsWith("pull_request")) {
    const head = readEvent(env.GITHUB_EVENT_PATH)?.pull_request?.head?.sha;
    if (typeof head === "string" && head !== "") return head;
  }
  return env.GITHUB_SHA ?? "";
}

// One request per status, a few at a time: a suite with a hundred tests
// should not open a hundred sockets at once.
const CONCURRENCY = 8;

// Posts every status and reports what happened. Never throws: a status is a
// courtesy on top of the run, and failing to write one must not turn a green
// suite red.
export async function postStatuses(statuses, options) {
  const { repo, sha, token, fetchImpl = fetch, apiBase = "https://api.github.com" } = options;
  const url = `${apiBase}/repos/${repo}/statuses/${sha}`;
  const queue = [...statuses];
  const result = { posted: 0, failed: 0, stopped: "" };

  const worker = async () => {
    // A token that may not write statuses may not write the next ninety-nine
    // either, so the first such answer stops the whole batch.
    while (queue.length > 0 && result.stopped === "") {
      const status = queue.shift();
      try {
        const response = await fetchImpl(url, {
          method: "POST",
          headers: {
            authorization: `Bearer ${token}`,
            accept: "application/vnd.github+json",
            "content-type": "application/json",
            "user-agent": "testfile-runner",
          },
          body: JSON.stringify(status),
        });
        if (response.ok) result.posted++;
        else if ([401, 403, 404].includes(response.status)) {
          result.stopped = `${response.status} ${response.statusText}`.trim();
        } else result.failed++;
      } catch {
        result.failed++; // network trouble; the run itself is unaffected
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker));
  return result;
}

if (process.argv[1] && process.argv[1].endsWith("statuses.mjs")) {
  const warn = (text) => console.log(`::warning title=Testfile::${text}`);
  const located = latestRun(process.argv[2]);
  const token = process.env.GITHUB_TOKEN ?? "";
  const repo = process.env.GITHUB_REPOSITORY ?? "";
  const sha = targetSha();

  if (!located) {
    // no recorded runs; annotate.mjs and summary.mjs stay quiet here too
  } else if (token === "") {
    warn("No token to write commit statuses with - pass `token:` to the action.");
  } else if (repo === "" || sha === "") {
    warn("No repository or commit to write commit statuses on.");
  } else {
    const server = process.env.GITHUB_SERVER_URL ?? "https://github.com";
    const runId = process.env.GITHUB_RUN_ID;
    const statuses = statusesOf(located.run, {
      prefix: process.env.INPUT_STATUS_PREFIX ?? "Testfile: ",
      targetUrl: runId ? `${server}/${repo}/actions/runs/${runId}` : undefined,
    });
    // GITHUB_API_URL is what makes this work on GitHub Enterprise Server,
    // where the API does not live at api.github.com.
    const result = await postStatuses(statuses, {
      repo,
      sha,
      token,
      apiBase: process.env.GITHUB_API_URL || undefined,
    });
    console.log(`posted ${result.posted}/${statuses.length} commit statuses on ${sha}`);
    if (result.stopped !== "") {
      warn(
        `Could not write commit statuses (${result.stopped}). The workflow needs \`permissions: statuses: write\`.`,
      );
    } else if (result.failed > 0) {
      warn(`${result.failed} of ${statuses.length} commit statuses could not be written.`);
    }
  }
}
