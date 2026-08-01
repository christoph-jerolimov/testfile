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
| `fail-fast` | `false` | Abort the whole run at the first failure. |
| `max-parallel` | – | Global cap on concurrently running tests. |
| `reporter` / `output` | – | Write [machine-readable results](./cli#machine-readable-reports) (`junit` or `json`). |
| `node-version` | `22` | Node.js version for the runner. |
| `annotations` | `true` | Emit GitHub annotations for failed tests — each failure appears on the PR with the tail of its log. |
| `summary` | `true` | Write a job-summary table of the run's results (status, duration and notes per test). |
| `upload-run` | `true` | Upload the recorded run (`.testfile/runs/<id>` as a `.tgz`) as a build artifact. |
| `artifact-name` | `testfile-run` | Name of the uploaded run artifact. |

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

Every action run uploads the recorded run as a `testfile-run` artifact —
the same self-contained `.testfile/runs/<id>/` folder the runner writes
locally. `testfile runs sync` downloads the artifacts of the latest
workflow runs and imports them into your local
[run history](./cli#run-history), where `testfile history`, `--diff`,
`--flaky` and the TUI's runs/results views treat them like local runs:

```sh
export GITHUB_TOKEN=...          # a token with actions:read
testfile runs sync you/your-repo --latest 10
testfile history                 # CI runs are now part of the history
```

See [sharing runs](./cli#sharing-runs) for the underlying `pack`/`import`
commands and the S3 variant.

Container services (postgres etc.) work out of the box on the standard
`ubuntu-latest` runners, which ship with docker.
