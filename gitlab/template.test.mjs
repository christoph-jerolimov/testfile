// The GitLab template derives the labels a recorded CI run carries the
// same way the GitHub Action does, but in bash inside the template's
// script. The derivation decides how a run can be found again, so it is
// pinned here: the script is executed against a fake GitLab context with
// npx and git stubbed out, and the arguments it would hand the runner
// are asserted.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
// the yaml dependency of the runner workspace, hoisted in the checkout
const require = createRequire(join(here, "..", "testfile-ts", "runner", "package.json"));
const { parse } = require("yaml");

const template = parse(readFileSync(join(here, "testfile.gitlab-ci.yml"), "utf8"));
const base = template[".testfile"];

// The script drives bash (arrays, process substitution); where there is
// none - Windows without a Git bash on PATH - the driving tests skip.
const bash = spawnSync("bash", ["-c", "true"]).status === 0;

// GitLab expands $VAR / ${VAR} in `variables:` values before the job
// runs; the test does the same so the template's own defaults are what
// is exercised.
function expand(value, env) {
  return String(value).replaceAll(
    /\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?/g,
    (_, name) => env[name] ?? "",
  );
}

// Runs the template's script items under a fake GitLab context. npx and
// git record their arguments (one call per file, one argument per line)
// instead of doing anything.
function run(context = {}, overrides = {}) {
  const dir = mkdtempSync(join(tmpdir(), "testfile-gitlab-template-"));
  try {
    const bin = join(dir, "bin");
    mkdirSync(bin);
    for (const stub of ["npx", "git"]) {
      const file = join(bin, stub);
      writeFileSync(
        file,
        `#!/bin/bash\nn=0\nwhile [ -e "$STUB_DIR/${stub}-$n" ]; do n=$((n+1)); done\nprintf '%s\\n' "$@" > "$STUB_DIR/${stub}-$n"\n`,
      );
      chmodSync(file, 0o755);
    }
    // the same joining and error mode the runner's generated script has
    const script = join(dir, "script.sh");
    writeFileSync(script, `set -eo pipefail\n${base.script.join("\n")}\n`);

    const variables = {};
    for (const [key, value] of Object.entries(base.variables)) {
      variables[key] = expand(value, context);
    }
    const result = spawnSync("bash", [script], {
      env: {
        PATH: `${bin}:${process.env.PATH}`,
        STUB_DIR: dir,
        ...variables,
        ...context,
        ...overrides,
      },
      encoding: "utf8",
    });

    const calls = { npx: [], git: [] };
    for (const entry of readdirSync(dir).sort()) {
      const match = /^(npx|git)-\d+$/.exec(entry);
      if (!match) continue;
      const lines = readFileSync(join(dir, entry), "utf8").split("\n");
      lines.pop(); // trailing newline
      calls[match[1]].push(lines);
    }
    return { result, calls };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// The `testfile start` invocation among the recorded npx calls.
function startArgs(calls) {
  const call = calls.npx.find((args) => args[2] === "start");
  assert.ok(call, "the script must invoke the runner's start command");
  assert.deepEqual(call.slice(0, 2), ["--yes", "@testfile.dev/runner"]);
  return call.slice(2);
}

// The --label key=value pairs of a start invocation, as a map.
function labelsOf(args) {
  const labels = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] !== "--label") continue;
    const at = args[i + 1].indexOf("=");
    labels[args[i + 1].slice(0, at)] = args[i + 1].slice(at + 1);
  }
  return labels;
}

// What GitLab sets for a push to a branch; the other cases override parts.
const push = {
  CI_PIPELINE_SOURCE: "push",
  CI_COMMIT_BRANCH: "main",
  CI_COMMIT_REF_NAME: "main",
  GITLAB_USER_LOGIN: "octocat",
  CI_PROJECT_PATH: "acme/app",
  CI_JOB_NAME: "testfile",
  CI_COMMIT_SHORT_SHA: "0123456",
  CI_PIPELINE_ID: "42",
};

test("the sync default finds the job: it is named testfile", () => {
  assert.equal(template.testfile.extends, ".testfile");
});

test("the recorded run and the junit report are kept as artifacts", () => {
  assert.equal(base.artifacts.when, "always");
  assert.ok(base.artifacts.paths.includes(".testfile/runs/"));
  assert.equal(base.artifacts.reports.junit, base.variables.TESTFILE_OUTPUT);
  assert.ok(base.artifacts.paths.includes(base.variables.TESTFILE_OUTPUT));
});

test("a push is labelled with its branch and who pushed it", { skip: !bash }, () => {
  const { result, calls } = run(push);
  assert.equal(result.status, 0, result.stderr);
  const args = startArgs(calls);
  assert.deepEqual(args.slice(0, 2), ["start", "."]);
  assert.deepEqual(labelsOf(args), {
    trigger: "push",
    branch: "main",
    actor: "octocat",
    repo: "acme/app",
    job: "testfile",
    sha: "0123456",
    "ci-run": "42",
  });
  // junit feeds GitLab's own test report by default
  assert.ok(args.join("\n").includes("--reporter\njunit\n--output\njunit.xml"));
  // doctor ran first, against the same path
  assert.deepEqual(calls.npx[0].slice(2), ["doctor", "."]);
});

test("a merge request is labelled with both branches and its number", { skip: !bash }, () => {
  const { result, calls } = run({
    ...push,
    CI_PIPELINE_SOURCE: "merge_request_event",
    CI_COMMIT_BRANCH: "",
    CI_MERGE_REQUEST_IID: "7",
    CI_MERGE_REQUEST_SOURCE_BRANCH_NAME: "feature/labels",
    CI_MERGE_REQUEST_TARGET_BRANCH_NAME: "main",
  });
  assert.equal(result.status, 0, result.stderr);
  const labels = labelsOf(startArgs(calls));
  assert.equal(labels.trigger, "merge_request");
  assert.equal(labels.branch, "feature/labels", "the branch proposed");
  assert.equal(labels.base, "main");
  assert.equal(labels.mr, "7");
  assert.equal(labels.tag, undefined);
});

test("a manual run says so in plain words", { skip: !bash }, () => {
  for (const source of ["web", "api", "trigger"]) {
    const { result, calls } = run({ ...push, CI_PIPELINE_SOURCE: source });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(labelsOf(startArgs(calls)).trigger, "manual");
  }
  // a source without a friendlier name keeps GitLab's own
  const { calls } = run({ ...push, CI_PIPELINE_SOURCE: "schedule" });
  assert.equal(labelsOf(startArgs(calls)).trigger, "schedule");
});

test("a tag build is labelled with the tag instead of a branch", { skip: !bash }, () => {
  const { result, calls } = run({ ...push, CI_COMMIT_BRANCH: "", CI_COMMIT_TAG: "v2.0.0" });
  assert.equal(result.status, 0, result.stderr);
  const labels = labelsOf(startArgs(calls));
  assert.equal(labels.tag, "v2.0.0");
  assert.equal(labels.branch, undefined);
});

test("nothing the context does not provide is recorded", { skip: !bash }, () => {
  const { result, calls } = run({ CI_PIPELINE_SOURCE: "push" });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(labelsOf(startArgs(calls)), { trigger: "push" });
});

test("the pipeline's own labels win over the automatic ones", { skip: !bash }, () => {
  const { result, calls } = run(push, {
    TESTFILE_LABELS: "tier=nightly, branch=release\n note = a=b, oops, =skipped",
  });
  assert.equal(result.status, 0, result.stderr);
  const args = startArgs(calls);
  assert.equal(
    args.filter((arg, i) => args[i - 1] === "--label" && arg.startsWith("branch=")).length,
    1,
  );
  const labels = labelsOf(args);
  assert.equal(labels.branch, "release", "an explicit value is the one the author meant");
  assert.equal(labels.tier, "nightly");
  assert.equal(labels.note, "a=b", "pairs split at the first =");
  assert.equal(labels.skipped, undefined);

  // the automatic set can be turned off
  const bare = run(push, { TESTFILE_AUTO_LABELS: "false", TESTFILE_LABELS: "tier=nightly" });
  assert.deepEqual(labelsOf(startArgs(bare.calls)), { tier: "nightly" });
});

test("filters, variants and the run flags reach the runner", { skip: !bash }, () => {
  const { result, calls } = run(push, {
    TESTFILE_PATH: "services/api",
    TESTFILE_FILTER: "checks",
    TESTFILE_FILTER_NAME: "unit",
    TESTFILE_FILTER_TAGS: "fast,lint",
    TESTFILE_FILTER_MATRIX: "node:22",
    TESTFILE_FAIL_FAST: "true",
    TESTFILE_MAX_PARALLEL: "4",
    TESTFILE_VARIANTS: "platform=linux, node=22",
    TESTFILE_DOCTOR: "false",
  });
  assert.equal(result.status, 0, result.stderr);
  const args = startArgs(calls);
  assert.deepEqual(args.slice(0, 10), [
    "start",
    "services/api",
    "-f",
    "checks",
    "-n",
    "unit",
    "-t",
    "fast,lint",
    "-m",
    "node:22",
  ]);
  const joined = args.join("\n");
  assert.ok(joined.includes("--fail-fast"));
  assert.ok(joined.includes("--max-parallel\n4"));
  assert.ok(joined.includes("--variant\nplatform=linux\n--variant\nnode=22"));
  // doctor was turned off, so start is the only runner call
  assert.equal(calls.npx.length, 1);
});

test("changed runs fetch the base branch and pass it on", { skip: !bash }, () => {
  const { result, calls } = run(
    {
      ...push,
      CI_PIPELINE_SOURCE: "merge_request_event",
      CI_MERGE_REQUEST_IID: "7",
      CI_MERGE_REQUEST_SOURCE_BRANCH_NAME: "feature",
      CI_MERGE_REQUEST_TARGET_BRANCH_NAME: "main",
    },
    { TESTFILE_CHANGED: "true" },
  );
  assert.equal(result.status, 0, result.stderr);
  // the merge request's target branch is the default base, fetched under
  // its remote-tracking name so --changed-since can resolve it
  assert.deepEqual(calls.git, [["fetch", "origin", "+refs/heads/main:refs/remotes/origin/main"]]);
  const joined = startArgs(calls).join("\n");
  assert.ok(joined.includes("--changed\n"));
  assert.ok(joined.includes("--changed-since\nmain"));
});
