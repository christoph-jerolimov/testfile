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
      - uses: actions/checkout@v4
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
- uses: actions/upload-artifact@v4
  if: always()
  with:
    name: test-results
    path: results.xml
```

Container services (postgres etc.) work out of the box on the standard
`ubuntu-latest` runners, which ship with docker.
