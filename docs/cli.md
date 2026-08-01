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
