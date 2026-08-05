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

The action installs Node, builds the runner, and executes `testfile run`
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
| `annotations` | `true` | Emit GitHub annotations for failed tests — each failure appears on the PR with the tail of its log. |
| `summary` | `true` | Write a job-summary table of the run's results (status, duration and notes per test). |
| `upload-run` | `true` | Upload the recorded run (`.testfile/runs/<id>` as a `.tgz`) as a build artifact. |
| `artifact-name` | `testfile-run` | Name of the uploaded run artifact. |
| `variants` | – | What tells this run apart from the other legs of a matrix, as `key=value` pairs separated by commas or newlines (e.g. `platform=ubuntu-latest`). Recorded in `run.yaml`; [merging](./cli#merging-runs) needs it. |

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
files/checks views) with one error per failed test carrying the last lines
of its log, plus a summary notice — no extra configuration needed. The job
summary shows a results table for every run, passing or failing.

## Bringing CI runs home

Every action run uploads the recorded run folder as a `testfile-run`
artifact — GitHub wraps it in a zip, so the artifact is a single zip with
`run.yaml` and the logs at its root. A manually downloaded artifact
imports with `testfile-viewer archive import testfile-run.zip`. `testfile-viewer github sync` downloads the artifacts of the latest
workflow runs — every artifact whose name *starts with* `testfile-run`, so
the per-platform legs and the merged run all arrive — and imports them into
your local
[run history](./cli#run-history), where `testfile-viewer runs`, `run`,
`diff`, `--flaky` and the TUI's runs/results views treat them like local
runs:

```sh
export GITHUB_TOKEN=...          # a token with actions:read (GH_TOKEN works too)
export GITHUB_TOKEN=$(gh auth token)   # ... or reuse the gh CLI's login
testfile-viewer github sync you/your-repo --latest 10
testfile-viewer runs             # CI runs are now part of the history
```

See [sharing runs](./cli#sharing-runs) for the underlying `pack`/`import`
commands and the S3 variant.

Container services (postgres etc.) work out of the box on the standard
`ubuntu-latest` runners, which ship with docker.

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
[`testfile-viewer merge`](./cli-reference#testfile-viewer-merge-run). The
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
is exactly that job: one Testfile, three platforms.
