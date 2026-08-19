---
title: Viewer & sync
order: 1
category: Review results
description: Browse recorded runs in the TUI or the web viewer, and pull CI runs into the local history with testfile github sync.
---

# Viewer & sync

Every run is recorded as a self-contained folder under `.testfile/runs/` —
the verdict, per-test statuses and durations, the test and service logs.
Reviewing results means reading those folders, and the same read-only
viewers work on any of them: runs from this machine, runs imported from a
colleague, and [CI runs pulled home](#bring-ci-runs-home).

## In the terminal

[`testfile tui`](./cli#the-tui) opens a terminal UI over the recorded runs:
a runs table and a tests table, a tree of each run with per-test logs and
service logs in tabs, sortable columns, log search and copyable selections.
It never starts tests — that is `testfile start`'s job.

## In the browser

[`testfile serve`](./cli#the-web-viewer) is the TUI's browser sibling:

```sh
testfile serve          # http://127.0.0.1:7357
testfile serve --port 8080
```

Runs, tests and executions page by page, a timeline per run, rendered log
colours, search in every log — and a watcher on `.testfile/runs/`, so runs
recorded elsewhere (another terminal, a `sync`) appear live. The
[screenshots](./screenshots) page walks through every view of both viewers.

## Bring CI runs home

CI runs are ordinary run folders too. When CI is the
[GitHub Action](./github-action), every job uploads its recorded run as a
`testfile-run` artifact, and
[`testfile github sync`](./github-action#bringing-ci-runs-home) pulls the
artifacts of the latest workflow runs straight into the local history:

```sh
export GITHUB_TOKEN=$(gh auth token)   # a token with actions:read
testfile github sync you/your-repo --latest 10
testfile runs                          # CI runs are now part of the history
```

Already-imported runs are skipped, so `sync` is incremental — run it again
any time to top up the history with the newest CI results; the viewers pick
the imported runs up live. `testfile gitlab sync` is the
[GitLab](./gitlab-ci) counterpart, and [sharing runs](./cli#sharing-runs)
covers the underlying `archive pack`/`import` commands and the S3 variant
for every other setup.

Once CI runs are local, they diff and aggregate like local ones: in the
[run history](./cli#run-history), `testfile diff` says what broke between
two runs, and `--flaky` finds the tests that flip status across the
history.
