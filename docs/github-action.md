---
title: GitHub Action
order: 8
description: Run your Testfile in GitHub Actions with one step.
---

# GitHub Action

The repository doubles as a GitHub Action, so running a Testfile in CI is a
single step:

```yaml
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: christoph-jerolimov/testfile@main
```

The action installs Node, builds the runner, and executes `testfile start`
against your repository's Testfile. The job fails when tests fail.

## Inputs

| Input | Default | Description |
| ----- | ------- | ----------- |
| `path` | `.` | Testfile or directory containing one. |
| `filter` / `filter-name` / `filter-tags` / `filter-matrix` | – | Same as the `-f`/`-n`/`-t`/`-m` [CLI filters](./cli#filtering). |
| `changed` | `false` | Run only tests whose `inputs` match files [changed against the base branch](./writing-tests#change-based-selection) (`--changed`). |
| `changed-since` | PR target branch | Base branch/ref for `changed`. Defaults to `github.base_ref`, so on pull requests the diff is against the PR's target branch. |
| `fail-fast` | `false` | Abort the whole run at the first failure. |
| `max-parallel` | – | Global cap on concurrently running tests. |
| `reporter` / `output` | – | Write [machine-readable results](./cli#machine-readable-reports) (`junit` or `json`). |
| `node-version` | `22` | Node.js version for the runner. |
| `doctor` | `true` | Run [`testfile doctor`](./cli#checking-the-machine) before the tests: every missing tool, engine or taken port that would fail the run anyway fails here instead, in one readable report. |
| `annotations` | `true` | Emit GitHub annotations for failed and aborted tests — each appears on the PR with the last 15 lines of its log. |
| `summary` | `true` | Write a job-summary table of the run's results (status, duration and notes per test). |
| `statuses` | `false` | Report one [commit status per test](#a-status-per-test) — needs `permissions: statuses: write`. |
| `status-prefix` | `Testfile: ` | Prefix of every status context, so the per-test statuses group together. |
| `token` | `github.token` | Token the commit statuses are written with. |
| `upload-run` | `true` | Upload the recorded run folder (`.testfile/runs/<id>`) as a build artifact — GitHub wraps it in a zip. |
| `artifact-name` | `testfile-run` | Name of the uploaded run artifact. |
| `variants` | – | What tells this run apart from the other legs of a matrix, as `key=value` pairs separated by commas or newlines (e.g. `platform=ubuntu-latest`; whitespace is stripped, so values cannot contain spaces). Recorded in `run.yaml`; [merging](./cli#merging-runs) needs it. |
| `labels` | – | Extra [labels](./cli#labelling-runs) to record, as `key=value` pairs separated by commas or newlines (e.g. `tier=nightly, owner=infra`). Merged with the automatic ones; a key you set yourself wins. |
| `auto-labels` | `true` | Label the run with the GitHub context — see below. |

## What a CI run is labelled with

Every run the action records is labelled with where it came from, so a
history collected from many workflows can be narrowed down afterwards
(`testfile serve` filters by label). Each label is a key and a
value; the runner takes them one `--label key=value` at a time.

| Key | Value |
| --- | ----- |
| `trigger` | how the workflow started: `manual` (a `workflow_dispatch` or `repository_dispatch`), `schedule` (a cron job), `push`, `pull_request`, or GitHub's own name for any other event |
| `branch` | the branch the run used — on a pull request the **source** branch, not the ephemeral merge ref |
| `base` | pull requests only: the **target** branch |
| `pr` | pull requests only: the pull request number |
| `tag` | tag builds only, instead of `branch` |
| `actor` | the GitHub username that triggered the run |
| `repo` | `owner/name` — worth having once runs from several repositories share a history |
| `workflow`, `job` | which workflow and job produced the run |
| `os` | the runner's operating system |
| `sha` | the short commit sha |
| `ci-run` | the Actions run id, to get from a recorded run back to its job |

A label is only recorded when the context supplies it, so a run never
carries an empty one. Your own `labels:` win over the automatic ones —
setting `branch=release` replaces the derived value rather than clashing
with it. Set `auto-labels: false` to record only your own.

## Examples

Only the fast tests on pull requests, everything nightly:

```yaml
- uses: christoph-jerolimov/testfile@main
  if: github.event_name == 'pull_request'
  with:
    filter-tags: fast
    fail-fast: true

- uses: christoph-jerolimov/testfile@main
  if: github.event_name == 'schedule'
  with:
    filter-tags: nightly
```

Only the tests a pull request could have affected, diffed against the PR's
target branch (note `fetch-depth: 0` — change detection needs the base
branch in the checkout, which a shallow single-commit clone doesn't have):

```yaml
- uses: actions/checkout@v7
  with:
    fetch-depth: 0
- uses: christoph-jerolimov/testfile@main
  with:
    changed: true
```

Tests without [`inputs`](./writing-tests#result-caching) always run, so a
suite adopts this incrementally: declare `inputs` on the expensive tests
first. Each selected test's log and `run.yaml` record why it ran — which
input pattern matched how many changed files.

JUnit results for your test-report tooling:

```yaml
- uses: christoph-jerolimov/testfile@main
  with:
    reporter: junit
    output: results.xml
- uses: actions/upload-artifact@v7
  if: always()
  with:
    name: test-results
    path: results.xml
```

When tests fail, the action annotates the workflow run (and the PR's
files/checks views) with one error per failed or aborted test carrying the
last 15 lines of its log, plus a summary notice — no extra configuration
needed. The job summary shows a results table for every run, passing or
failing.

## A status per test

By default a commit gets one verdict from the action: the job passed or it
did not. With `statuses: true` every test that ran reports its own commit
status instead, so the pull request's checks list names the test that broke
rather than the job it was hiding in:

```yaml
jobs:
  test:
    runs-on: ubuntu-latest
    # a status is a write to the repository; the default token may not have it
    permissions:
      contents: read
      statuses: write
    steps:
      - uses: actions/checkout@v7
      - uses: christoph-jerolimov/testfile@main
        with:
          statuses: true
```

That produces one status per test, named after the test's path behind the
`status-prefix`:

| Status | State | Description |
| ------ | ----- | ----------- |
| `Testfile: ci/install` | success | `passed in 12.4s` |
| `Testfile: ci/checks/lint` | success | `passed in 900ms (cached)` |
| `Testfile: ci/checks/unit` | failure | `failed in 2.0s` |
| `Testfile: ci/checks/e2e` | success | `skipped` |

An aborted test (or a status the reporter does not recognize) maps to the
`error` state. Each status links back to the workflow run (when the run id
is available). A few details worth knowing:

- **Only the tests get a status**, not the `sequence` and `parallel` groups
  around them — a group's result is the aggregate its children already
  report, and the job's own status covers the run as a whole.
- **On a pull request the status lands on the PR's head commit**, not on the
  ephemeral merge commit, which is where GitHub shows it.
- **Skipped tests report success**, with `skipped` as the description. A
  commit status has no neutral state, and a [required
  check](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches#require-status-checks-before-merging)
  left pending forever would block the pull request over a test that was
  never meant to run on this platform.
- **`variants` go into the context.** The legs of a matrix all report on the
  same commit, so `variants: platform=${{ matrix.os }}` makes the contexts
  `Testfile: ci/checks/lint (platform=ubuntu-latest)` and the legs stop
  overwriting each other. Without it the last leg to finish wins.
- **Writing a status never fails the build.** A token without
  `statuses: write` gets one warning in the log, not a red job — and the
  remaining statuses of that run are not attempted, so with a bad token no
  statuses appear at all rather than a partial set. Transient network
  failures are counted and warned about separately.
- **GitHub Enterprise Server works**: the reporter honours
  `GITHUB_API_URL` and `GITHUB_SERVER_URL`.

Because the contexts are stable, they can be used as required checks — pick
`Testfile: ci/checks/unit` in the branch protection rules and a pull request
cannot merge while that one test is red, whatever the rest of the suite
does. Keep in mind that a test which stops being selected (by a filter, or
by `changed`) stops reporting its status too, and a required check that
never arrives blocks the merge. GitHub caps a status context at 255
characters and its description at 140 — longer ones are truncated with `…`,
so a very deep test path plus a long prefix and variants may produce a
context that differs from the one you would type into a branch rule.

## Bringing CI runs home

Every action run uploads the recorded run folder as a `testfile-run`
artifact — GitHub wraps it in a zip, so the artifact is a single zip with
`run.yaml` and the logs at its root. A manually downloaded artifact
imports with `testfile archive import testfile-run.zip`. `testfile github sync` downloads the artifacts of the latest
workflow runs — every artifact whose name *starts with* `testfile-run`, so
the per-platform legs and the merged run all arrive — and imports them into
your local
[run history](./cli#run-history), where `testfile runs`, `inspect run`,
`diff`, `--flaky` and the TUI's runs/tests views treat them like local
runs:

```sh
export GITHUB_TOKEN=...          # a token with actions:read (GH_TOKEN works too)
export GITHUB_TOKEN=$(gh auth token)   # ... or reuse the gh CLI's login
testfile github sync you/your-repo --latest 10
testfile runs             # CI runs are now part of the history
```

See [sharing runs](./cli#sharing-runs) for the underlying `pack`/`import`
commands and the S3 variant.

Container services (postgres etc.) work out of the box on the standard
`ubuntu-latest` runners, which ship with docker — the runner's
[engine selection](./services#containers) finds it on its own. To pin the
engine explicitly (or to run services on a cluster the job can reach), set
the environment variable the runner reads:

```yaml
- uses: christoph-jerolimov/testfile@main
  env:
    TESTFILE_ENGINE: kubernetes
```

## More than one platform

The action runs on the Windows and macOS runners too, so one matrix job
covers all three:

```yaml
jobs:
  test:
    name: Testfile CI (${{ matrix.os }})
    strategy:
      fail-fast: false
      matrix:
        os: [ubuntu-latest, macos-latest, windows-latest]
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v7
      - uses: christoph-jerolimov/testfile@main
        with:
          # what tells the legs apart when their runs are merged
          variants: platform=${{ matrix.os }}
          # artifact names are unique per workflow run
          artifact-name: testfile-run-${{ matrix.os }}
```

Three platforms means three recorded runs. A follow-up job combines them
into a single run — one verdict, one duration, every test tagged with the
platform it ran on — with
[`testfile merge`](./cli-reference#testfile-merge-run). The
[three-platform guided tour](./three-platforms) walks through the whole
workflow, merge job included.

Two things to know before you do:

- **Container tests are Linux-only.** The macOS runners have no container
  engine at all, and the Windows runners only run Windows images, so a
  `container:` or a containerised service cannot work there. Gate those
  tests with [`if`](./writing-tests#conditional-tests) on `TESTFILE_OS` instead of
  splitting the suite across workflows — they are then reported as skipped
  on the platforms that cannot run them:

  ```yaml
  - name: integration
    if: ${{ env.TESTFILE_OS }} == linux
    services:
      db: { container: { image: postgres:16 } }
    command: npm run test:integration
  ```

- **Commands still run in a POSIX shell.** On Windows that is the `sh` of
  the Git installation every runner has, not `cmd` or PowerShell, so the
  same `command:` works everywhere — but a test that shells out to
  platform-specific tooling needs the same `if` treatment.

This repository's own [CI](https://github.com/christoph-jerolimov/testfile/blob/main/.github/workflows/ci.yaml)
is that job — one Testfile, three platforms — plus a merge job combining
the three runs and a kind cluster on the Linux leg for the kubernetes
conformance case.

## Letting an assistant read the failure

A red CI run usually reaches a person as a link and a wall of log. The run
folder holds better material than that, and the action already uploads it,
so a follow-up job can hand a failure to an assistant with the evidence
attached instead of the URL.

```yaml
  triage:
    needs: test
    if: failure()
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write
    steps:
      - uses: actions/checkout@v7
      - uses: actions/download-artifact@v5
        with:
          pattern: testfile-run*
          path: runs
      # the downloaded artifacts become an ordinary local history
      - run: npx @testfile/viewer archive import runs/*/testfile-run*.zip
      # what failed, why, and what changed - bounded, and already prose
      - run: npx @testfile/viewer explain --max-failures 5 > digest.md
      - uses: anthropics/claude-code-action@v1
        with:
          anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}
          prompt: |
            The CI run below failed. Work out whether each failure is real
            or a known flake, and what caused it. Do not change any code.
            $(cat digest.md)
```

The digest is the point: it is already the shape an assistant needs
(failing tests, their reasons, log excerpts, the flaky verdict, the
comparison with the previous run), it is bounded, and it costs one command
rather than a prompt that has to explain the layout of `.testfile/`.

Give the job the [MCP server](./cli#talking-to-an-ai-assistant) instead of
a digest when the assistant should be able to dig further —
`testfile mcp` over the same imported history lets it pull a
specific log or reproduce one test on its own.

### Writing the conclusion back

An analysis that lives only in a job log is lost by the next run. The
result format has a place for it: an optional
[`analysis`](https://github.com/christoph-jerolimov/testfile/blob/main/spec/RESULTS.md#analysis)
field on `run.yaml`, which every viewer shows next to the run — marked as
somebody's reading of it, never as a result.

```sh
node -e '
  const { readFileSync, writeFileSync } = require("node:fs");
  const { parse, stringify } = require("yaml");
  const file = process.argv[1], run = parse(readFileSync(file, "utf8"));
  run.analysis = { text: readFileSync("finding.md", "utf8"), author: "claude-code",
                   at: new Date().toISOString() };
  writeFileSync(file, stringify(run));
' .testfile/runs/<id>/run.yaml
```

A runner never writes that field, and neither does any viewer — the
viewers are read-only. Whoever did the reading writes it, and must
preserve every other field of the record.
