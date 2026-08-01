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
testfile run --fail-fast   # abort everything at the first failure
testfile run --max-parallel 4   # global cap on concurrently running tests
testfile run --dry-run     # print what would run, without running
testfile validate [path]   # validate against the JSON schema
testfile list [path]       # print the expanded tree, incl. matrix instances
testfile history [path]    # list or show recorded runs
```

`--fail-fast` aborts running siblings and skips everything queued as soon as
one test fails. `--max-parallel` limits how many tests run at the same time
across the *whole* run (group-level `maxParallel` still applies on top).
`--dry-run` combines with all filter flags, so you can preview exactly what
a filter expression will run. All three also apply to runs started from the
TUI.

`path` may be a Testfile or a directory containing one (`Testfile`,
`testfile.yaml` or `testfile.yml`); it defaults to the current directory.

Exit codes: `0` all tests passed · `1` failures or a service that would not
start · `130` interrupted.

## Filtering

`run` and `list` accept filters to work on a subset of the tree:

```sh
testfile run -f e2e                          # best guess: name, tag, ...
testfile run -f fast                         # ... tag ...
testfile run -f db:postgres                  # ... or matrix (it has a ":")
testfile run --filter-name all/checks/unit   # -n: match name/path only
testfile run --filter-tags "slow, nightly"   # -t: tagged slow OR nightly
testfile run --filter-matrix db:postgres     # -m: only these matrix instances
testfile run -t slow -m db:postgres -m node:22
```

- `-f, --filter <value>` is the quick, best-guess filter: a value containing
  `:` is treated as a `key:value` matrix filter; anything else matches tests
  whose path contains the value **or** that carry it as a tag. Repeatable.
- `-n, --filter-name <name-or-path>` matches case-insensitively against the
  test's *path* — its names joined with `/`, e.g. `all/checks/unit tests` —
  so a bare test name works too. A matched test runs with its whole subtree;
  ancestors run as scaffolding (their sequence order, services and env still
  apply). Repeat the flag to match more tests.
- `-t, --filter-tags <tags>` takes a comma-separated list of
  [tags](./writing-tests#tags) (whitespace is trimmed) and keeps tests that
  carry — or inherit from an ancestor — any of them. The flag can be
  repeated.
- `-m, --filter-matrix <key:value>` keeps only matrix instances whose
  combination has that value. Repeating the same key ORs the values,
  different keys are ANDed; tests outside a matrix with that key are
  unaffected.

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

Browse the history from the command line:

```sh
testfile history                          # table of recent runs, newest first
testfile history --run 20260801-1046      # one run in detail (id prefix is ok)
testfile history --run <id> --log         # merged stdout+stderr of the run
testfile history --run <id> --log all/e2e # ... of a single test
```

The detail view lists every recorded test with status, duration and whether
a log is available. `history` only needs the `.testfile/` folder, so it also
works when the Testfile itself has moved or changed.

## Interrupting a run

The first Ctrl+C aborts running tests and shuts down all services through
their configured `stop` behavior (signal, grace period, then SIGKILL;
`podman stop`/`docker stop` for containers). A second Ctrl+C skips the grace
period and kills everything immediately.
