// The labels the action attaches to every run it records, derived from the
// GitHub context. They are what makes a recorded run findable later: which
// branch, which pull request, who started it and how.
//
// Labels are free-form strings (spec/RESULTS.md); these use a `key=value`
// shape by convention so a viewer's text filter can match either half. The
// shape is a convention only - consumers must not parse it.

// A short commit sha reads better in a label than 40 hex characters, and is
// still enough to find the commit.
function shortSha(sha) {
  return typeof sha === "string" ? sha.slice(0, 7) : "";
}

// GitHub's event names spell out how a workflow started; two of them are
// worth saying in plain words, because "was this a nightly or did someone
// press the button" is a question people actually ask.
function triggerOf(eventName) {
  if (eventName === "workflow_dispatch") return "manual";
  if (eventName === "repository_dispatch") return "manual";
  if (eventName === "schedule") return "schedule";
  return eventName;
}

// Every label the GitHub context can supply, in a stable order. Anything the
// environment does not provide is left out rather than recorded as empty.
export function githubLabels(env = process.env) {
  const labels = [];
  const add = (key, value) => {
    const text = typeof value === "string" ? value.trim() : "";
    if (text !== "") labels.push(`${key}=${text}`);
  };

  const event = (env.GITHUB_EVENT_NAME ?? "").trim();
  add("trigger", triggerOf(event));

  // On a pull request the interesting branch is the one being proposed, not
  // the ephemeral merge ref GITHUB_REF points at - and that ref is where the
  // pull request's number comes from: refs/pull/<number>/merge.
  const isPullRequest = event.startsWith("pull_request");
  const headRef = (env.GITHUB_HEAD_REF ?? "").trim();
  if (isPullRequest && headRef !== "") {
    add("branch", headRef);
    add("base", env.GITHUB_BASE_REF);
    add("pr", /^refs\/pull\/(\d+)\//.exec(env.GITHUB_REF ?? "")?.[1]);
  } else if ((env.GITHUB_REF_TYPE ?? "").trim() === "tag") {
    add("tag", env.GITHUB_REF_NAME);
  } else {
    add("branch", env.GITHUB_REF_NAME);
  }

  add("actor", env.GITHUB_ACTOR);
  add("repo", env.GITHUB_REPOSITORY);
  add("workflow", env.GITHUB_WORKFLOW);
  add("job", env.GITHUB_JOB);
  add("os", env.RUNNER_OS);
  add("sha", shortSha(env.GITHUB_SHA));
  add("ci-run", env.GITHUB_RUN_ID);

  return labels;
}

// The action's `labels` input: one label per line, commas allowed as a
// separator so a workflow can write `labels: nightly, slow`.
export function inputLabels(text) {
  return String(text ?? "")
    .split(/[,\n]/)
    .map((label) => label.trim())
    .filter((label) => label !== "");
}

// Everything the run should be labelled with, de-duplicated, the automatic
// ones first.
export function runLabels({ env = process.env, input = "", auto = true } = {}) {
  const labels = [...(auto ? githubLabels(env) : []), ...inputLabels(input)];
  return [...new Set(labels)];
}

// Printed one per line for the shell to read into the runner's arguments.
if (process.argv[1] && process.argv[1].endsWith("labels.mjs")) {
  const auto = (process.env.INPUT_AUTO_LABELS ?? "true") !== "false";
  for (const label of runLabels({ input: process.env.INPUT_LABELS, auto })) {
    console.log(label);
  }
}
