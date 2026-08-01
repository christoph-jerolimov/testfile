---
title: CLI & TUI
order: 7
description: The testfile command line runner and its interactive terminal UI.
---

# CLI & TUI

The reference runner lives in
[`runner-ts`](https://github.com/christoph-jerolimov/testfile/tree/main/runner-ts)
and installs a `testfile` binary.

## Commands

```sh
testfile run [path]        # run the tree (default command)
testfile run --tui         # interactive terminal UI
testfile run --verbose     # also stream service output
testfile validate [path]   # validate against the JSON schema
testfile list [path]       # print the expanded tree, incl. matrix instances
```

`path` may be a Testfile or a directory containing one (`Testfile`,
`testfile.yaml` or `testfile.yml`); it defaults to the current directory.

Exit codes: `0` all tests passed · `1` failures or a service that would not
start · `130` interrupted.

## Filtering

`run` and `list` accept filters to work on a subset of the tree:

```sh
testfile run --filter-name e2e               # tests whose path contains "e2e"
testfile run --filter-name all/checks/unit   # ... or a full path
testfile run --filter-tags fast              # tests tagged fast
testfile run --filter-tags "slow, nightly"   # ... or slow OR nightly
testfile run --matrix-filter db:postgres     # only these matrix instances
testfile run --filter-tags slow --matrix-filter db:postgres --matrix-filter node:22
```

- `--filter-name <name-or-path>` matches case-insensitively against the
  test's *path* — its names joined with `/`, e.g. `all/checks/unit tests` —
  so a bare test name works too. A matched test runs with its whole subtree;
  ancestors run as scaffolding (their sequence order, services and env still
  apply). Repeat the flag to match more tests.
- `--filter-tags <tags>` takes a comma-separated list of
  [tags](./writing-tests#tags) (whitespace is trimmed) and keeps tests that
  carry — or inherit from an ancestor — any of them. The flag can be
  repeated.
- `--matrix-filter <key:value>` keeps only matrix instances whose combination
  has that value. Repeating the same key ORs the values, different keys are
  ANDed; tests outside a matrix with that key are unaffected.

Different filter kinds are ANDed. Filters that match nothing are an error.
With `--tui`, filters pre-select the matching tests instead of running them
immediately. `testfile list` shows each test's tags, so it's an easy way to
preview what a filter will run.

## Plain output

Without `--tui` the runner streams progress line by line — suitable for CI
logs. Test output is prefixed with `[test name]`; service output is shown
with `--verbose`, and the tail of a failing service's log is always printed.
A summary tree with per-test durations is printed at the end.

## The TUI

`testfile run --tui` opens a two-pane terminal UI. It does **not** start any
tests by itself: pick the tests you want with the selection keys, then press
enter to run them — as often as you like within one session.

- The **left pane** lists the whole test tree (including matrix instances)
  with a selection checkbox per test — `[x]` selected, `[~]` covered by a
  selected ancestor — and, once a run started, every service with its state
  (starting, ready, stopping, stopped, failed). Tests that have not run in
  this session show the result and duration of their most recent recorded
  run (`last ✔ 1.2s`).
- The **right pane** shows the log of whatever the cursor is on: the live
  (or queued) log while a run is in progress, otherwise the merged
  stdout+stderr of the test's previous recorded run.
- The **summary line** counts selected, running, queued, passed and failed
  tests.

Keys:

| Key       | Action |
| --------- | ------ |
| `↑`/`↓` (`k`/`j`) | Move the cursor over tests and services. |
| Space     | Toggle selection of the current test (its subtree runs with it). |
| `a`       | Select all tests (or clear the selection). |
| `c`       | Select all children of the current test. |
| Enter     | Run the selected tests. |
| `q` / Ctrl+C | While running: stop gracefully, press again to force-kill. Otherwise: quit. |

## Run history

Every run — CLI and TUI alike — is recorded in a `.testfile/` folder next to
the Testfile (the folder ignores itself via a generated `.gitignore`):

```
.testfile/
  runs.yaml            # index of the most recent runs (newest first)
  runs/<run-id>/
    output.log         # merged stdout+stderr of the whole run
    tests/<test>.log   # merged stdout+stderr per test
```

`runs.yaml` stores for each run: start time, duration, status
(passed/failed/aborted), exit code, whether it was cancelled, the env
variables and ports provided by the Testfile, which tests were selected, and
the status/duration/log of every test that ran. The last 50 runs are kept;
older run folders are pruned automatically.

## Interrupting a run

The first Ctrl+C aborts running tests and shuts down all services through
their configured `stop` behavior (signal, grace period, then SIGKILL;
`podman stop`/`docker stop` for containers). A second Ctrl+C skips the grace
period and kills everything immediately.
