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
testfile init [path]       # create a starter Testfile (from package.json)
testfile run [path]        # run the tree (default command)
testfile tui [path]        # interactive terminal UI (tests, history, services)
testfile run --tui         # ... the same, sharing run's flags
testfile run --verbose     # also stream service output
testfile run --fail-fast   # abort everything at the first failure
testfile run --max-parallel 4   # global cap on concurrently running tests
testfile run --dry-run     # print what would run, without running
testfile validate [path]   # validate against the JSON schema
testfile list [path]       # print the expanded tree, incl. matrix instances
testfile history [path]    # list or show recorded runs
testfile completion bash   # shell completions (bash, zsh, fish)
```

Tab completion for commands and flags:

```sh
source <(testfile completion bash)                        # bash
testfile completion zsh > "${fpath[1]}/_testfile"         # zsh
testfile completion fish > ~/.config/fish/completions/testfile.fish
```

`--no-cache` ignores [cached results](./writing-tests#result-caching) for
tests with `inputs` (fresh results still refresh the cache).
`--fail-fast` aborts running siblings and skips everything queued as soon as
one test fails. `--max-parallel` limits how many tests run at the same time
across the *whole* run (group-level `maxParallel` still applies on top).
`--dry-run` combines with all filter flags, so you can preview exactly what
a filter expression will run; tests whose [inputs](./writing-tests#result-caching)
are unchanged are marked `[cached]`, with a would-run/served-from-cache
summary. All three also apply to runs started from the
TUI.

## Machine-readable reports

For CI systems, `--reporter` writes the run's result after it finished:

```sh
testfile run --reporter junit --output results.xml
testfile run --reporter json --output results.json
testfile run --reporter json           # ... or to stdout
```

The JUnit XML contains one `<testcase>` per executed test (group path as
classname) with `<failure>` elements carrying the merged log and
`<skipped/>` markers; the JSON report is the same record that `runs.yaml`
stores. In watch mode the report is rewritten after every re-run; with
`--tui` it is written when the TUI exits.

## Watch mode

`testfile run --watch` (or `-w`) re-runs the current selection whenever a
file in the project changes — combined with filters (`-w -t fast`) it makes
a tight edit-test loop:

```sh
testfile run -w -f unit
testfile run --tui --watch      # the TUI re-runs your last selection
```

Changes are debounced, edits made while a run is in progress trigger one
re-run afterwards, and `.git/`, `node_modules/` and `.testfile/` are
ignored. Every re-run is recorded in the history like a normal run. Ctrl+C
while idle exits with the last run's exit code; during a run it stops the
run first.

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

`--changed` runs only tests whose [inputs](./writing-tests#result-caching)
changed — predicted cache misses. Tests without `inputs` always count as
changed; it composes with the other filters, works on `list` for preview,
and errors when every selected test would come from the cache.

`--failed` re-runs what broke last time: it keeps only tests that failed (or
were aborted) in the most recent recorded run, and combines with the other
filters — `testfile run --failed -t integration` re-runs only the failed
integration tests.

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

`testfile tui` opens a two-pane terminal UI with three top-level views,
switched with `1`/`2`/`3` (shown in the header line):

1. **tests** — the test tree, for selecting and running tests.
2. **history** — every recorded run, with details and the merged log.
3. **services** — all services the Testfile defines: the ones currently
   started and the startable ones that run on demand.

`testfile run --tui` opens the same TUI on the tests view (honoring `run`'s
filters, `--watch` and `--reporter`); `testfile history --tui` opens it on
the history view. The TUI does **not** start any tests by itself: pick the
tests you want with the selection keys, then press enter to run them — as
often as you like within one session.

### Tests view

- The **left pane** lists the whole test tree (including matrix instances)
  with a selection checkbox per test — `[x]` selected, `[~]` covered by a
  selected ancestor. Tests that have not run in this session show the
  result and duration of their most recent recorded run (`last ✔ 1.2s`).
- The **right pane** has three tabs per test, cycled with the tab key:
  - **info** — everything known about the test before running it: command
    or script, shell, working directory, timeout, retry policy, `if`
    condition, tags, matrix combination, inputs, artifacts, the env
    declared along its ancestor chain, the services it depends on (with
    their readiness checks), hooks, and its last recorded result.
  - **log** — the live (or queued) log while a run is in progress,
    otherwise the merged stdout+stderr of the test's previous recorded run.
  - **history** — a table of the test's recorded outcomes: one row per run
    with start time, status, duration and markers for cached results,
    artifacts and logs.
- The **summary line** counts selected, running, queued, passed and failed
  tests.

### History view

The left pane lists all recorded runs (newest first); the right pane shows
the selected run's details — status, duration, env, ports, per-test results
— and toggles to the run's merged log with enter.

### Services view

The left pane lists every service with its state: `startable` for defined
services that have not been started (services start with the tests that
need them), otherwise the live state (starting, ready, stopping, stopped,
failed) and where it was declared. The right pane shows a running service's
resolved details — image, port mappings, env (secret values masked) — and
its live log; for a startable service it shows the declared configuration
including the readiness and stop behavior. `r` restarts a running service.

### Keys

| Key       | Action |
| --------- | ------ |
| `1`/`2`/`3` | Switch between the tests, history and services views. |
| `↑`/`↓` (`k`/`j`) | Move the cursor in the active view's list. |
| Mouse wheel | Scroll the log/detail pane; at the bottom it follows the tail again. |
| Tab       | Tests view: cycle the detail tabs (info, log, history). |
| Space     | Toggle selection of the current test (its subtree runs with it). |
| `a`       | Select all tests (or clear the selection). |
| `c`       | Select all children of the current test. |
| `f`       | Select the failed tests — from this session, or from the last recorded run. |
| Enter     | Tests view: run the selected tests. History view: toggle details / merged log. |
| `/`       | Search: type to filter the tree (matches with their ancestors); enter keeps the filter, esc clears it. |
| `←`/`→` (`h`/`l`) | Collapse / expand the current group. |
| PgUp/PgDn (`u`/`d`) | Scroll the log pane; it follows the tail when at the bottom. |
| `r`       | Services view: stop the service and start it again with the same configuration. |
| `?`       | Search within the log pane; enter jumps to the latest match, `n`/`N` step older/newer, matches are highlighted. |
| `w`       | Toggle line wrapping in the log pane. |
| Esc       | History/services view: back to the tests view. |
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
testfile history --tui                    # browse runs in the TUI's history view
testfile history --run 20260801-1046      # one run in detail (id prefix is ok)
testfile history --run <id> --log         # merged stdout+stderr of the run
testfile history --run <id> --log all/e2e # ... of a single test
```

The detail view lists every recorded test with status, duration and whether
a log is available. `history` only needs the `.testfile/` folder, so it also
works when the Testfile itself has moved or changed.

Compare two runs (older id first, unique prefixes are enough):

```sh
testfile history --diff 20260801-1040 20260801-1146
```

The diff lists newly failed, fixed and still-failing tests, tests added to
or removed from the run, and significant duration changes (more than 100ms
and more than 20%) of tests that passed in both runs.

Hunt down flaky tests:

```sh
testfile history --flaky            # across all recorded runs
testfile history --flaky --last 10  # only the 10 most recent runs
```

A test is flagged when it both passed and failed across the considered runs
(skipped and aborted outcomes are ignored). The report shows the failure
rate, how often the outcome *flipped* between consecutive occurrences — the
strongest flakiness signal — and the latest status. Flagged tests are good
candidates for a `flaky` tag and a [`retry`](./writing-tests#retries).

## Interrupting a run

The first Ctrl+C aborts running tests and shuts down all services through
their configured `stop` behavior (signal, grace period, then SIGKILL;
`podman stop`/`docker stop` for containers). A second Ctrl+C skips the grace
period and kills everything immediately.
