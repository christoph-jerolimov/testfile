---
title: CLI & TUI
order: 7
description: The testfile command line runner and its interactive terminal UI.
---

# CLI & TUI

Two binaries share the work: the **runner** `testfile`
([`runner-ts`](https://github.com/christoph-jerolimov/testfile/tree/main/runner-ts))
reads the Testfile, runs processes and writes the recorded runs; the
**viewer** `testfile-viewer`
([`viewer-ts`](https://github.com/christoph-jerolimov/testfile/tree/main/viewer-ts))
is strictly read-only over those recorded runs — any tool producing the
documented [result format](https://github.com/christoph-jerolimov/testfile/tree/main/spec)
works with it.

This page is the guided tour; the [CLI reference](./cli-reference) lists
every command with all of its arguments and options.

## Commands

```sh
# the runner
testfile init [path]       # create a starter Testfile (from package.json)
testfile run [path]        # run the test suite (default command)
testfile run --verbose     # also stream service output
testfile run --fail-fast   # abort everything at the first failure
testfile run --max-parallel 4   # global cap on concurrently running tests
testfile run --dry-run     # print what would run, without running
testfile run --watch       # re-run on file changes
testfile run --reporter junit --output results.xml   # report for CI
testfile validate [path]   # validate against the JSON schema
testfile list [path]       # print the expanded suite, incl. matrix instances
testfile completion bash   # shell completions (bash, zsh, fish)

# the viewer (read-only over .testfile/)
testfile-viewer history        # list or show recorded runs (default command)
testfile-viewer tui            # terminal UI: runs + results, watching
testfile-viewer serve          # localhost REST API + web viewer
testfile-viewer runs <cmd>     # pack/import/push/pull/sync recorded runs
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
summary.

## Machine-readable reports

For CI systems, `--reporter` writes the run's result after it finished:

```sh
testfile run --reporter junit --output results.xml
testfile run --reporter json --output results.json
testfile run --reporter json           # ... or to stdout
```

The JUnit XML contains one `<testcase>` per executed test (group path as
classname) with `<failure>` elements carrying the merged log and
`<skipped/>` markers; the JSON report is the same record that the run's
`run.yaml` stores. In watch mode the report is rewritten after every re-run.

## Watch mode

`testfile run --watch` (or `-w`) re-runs the current selection whenever a
file in the project changes — combined with filters (`-w -t fast`) it makes
a tight edit-test loop:

```sh
testfile run -w -f unit
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

`run` and `list` accept filters to work on a subset of the suite:

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
  so a bare test name works too. A matched test runs with all its nested tests;
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
match a file changed against the base branch — the committed diff since the
fork point plus everything changed locally (staged, unstaged, untracked).
It needs a git checkout, not a warm cache, so it works on fresh CI clones;
see [change-based selection](./writing-tests#change-based-selection). Tests
without `inputs` always count as changed; it composes with the other
filters, works on `list` for preview, and errors when nothing is selected.
`--changed-since <ref>` picks the base branch (default: the remote's
default branch) and implies `--changed`. Selected tests log which pattern
matched how many changed files, and record it as `reason` in `run.yaml`.

`--failed` re-runs what broke last time: it keeps only tests that failed (or
were aborted) in the most recent recorded run, and combines with the other
filters — `testfile run --failed -t integration` re-runs only the failed
integration tests.

Different filter kinds are ANDed. Filters that match nothing are an error.
`testfile list` shows each test's tags, so it's an easy way to preview what
a filter will run.

## Tags

`testfile tags` inventories every tag of the full expanded suite —
[included Testfiles](./writing-tests#including-other-testfiles) and matrix
instances included — so you know what `-t` can filter on:

```sh
$ testfile tags                    # all tags, alphabetically
fast
integration
nightly

$ testfile tags --order appearance # in document order
$ testfile tags --order count      # most-used first, with counts
3  fast
2  nightly
1  integration

12 tests, 4 without any tag

$ testfile tags --json             # machine-readable, or --json tags.json
```

Counts count runnable tests (command/script leaves, every matrix instance
separately) that carry the tag directly **or inherited from an ancestor** —
the same semantics `-t` filters with. The count view also reports how many
tests have no tag at all; the JSON export always includes both numbers.

## Changes

`testfile changes` shows exactly what `--changed` selects tests from: the
base branch, the current commit, and an alphabetical table of every file
changed in the git diff (base → HEAD, from the fork point) or locally:

```sh
$ testfile changes
base:  origin/main (0cc2875ab)
head:  6d5dd5a91
root:  /work/project

file                       source  status
runner/src/cli.ts          diff    modified
runner/src/gitchanges.ts   diff    added
package.json               local   modified

3 changed files
```

`source` says where a change was found: `diff` (committed since the base
branch) or `local` (dirty in the working copy — a file that is both appears
once, as `local`). Options:

```sh
testfile changes --changed-since origin/release-2.0   # pick the base
testfile changes --files                              # just the paths
testfile changes --json changes.json                  # export as JSON
testfile changes --json                               # ... to stdout
```

To debug why a specific test would (not) run, combine the file list with
`testfile list --changed` or `testfile run --changed --dry-run`.

## Plain output

`testfile run` streams progress line by line — suitable for CI
logs. Test output is prefixed with `[test name]`; service output is shown
with `--verbose`, and the tail of a failing service's log is always printed.
A nested summary with per-test durations is printed at the end.

## The TUI

`testfile-viewer tui` opens a read-only two-pane terminal UI over the
recorded runs (it never starts tests — that is `testfile run`'s job). Two
views, switched with `1`/`2`:

1. **runs** — a table of every recorded run (started, status, duration,
   per-status counts); the right pane shows the selected run's details —
   status, env, ports, per-test results, services — and toggles to the
   merged log with enter.
2. **results** — every test that appears in a recorded run, with latest
   status and aggregated pass/fail counts; the right pane shows the
   selected test's executions across all runs as a table.

Both views watch `.testfile/runs/` — runs recorded by other processes
(say, a `testfile run` in a second terminal, or `testfile-viewer runs
sync`) appear live. `--view results` opens on the results view.

Keys: `↑`/`↓` (`k`/`j`) select · enter toggles details/merged log (runs
view) · `?` in-log search with `n`/`N` · `w` wrap · PgUp/PgDn (`u`/`d`) or
the mouse wheel scroll the log pane · `q` quits.

## Run history

Every run — CLI and TUI alike — is recorded in a `.testfile/` folder next to
the Testfile (the folder ignores itself via a generated `.gitignore`). Each
run is a self-contained folder:

```
.testfile/
  runs/<run-id>/
    run.yaml           # the run's record
    junit.xml          # the run as JUnit XML, for CI tooling
    tests/<test>.log   # merged stdout+stderr per test
    services/<svc>.log # log of each started service
```

`run.yaml` stores the run's start time, duration, status
(passed/failed/aborted), exit code, whether it was cancelled, the env
variables and ports provided by the Testfile, which tests were selected, and
the status/duration/log of every test that ran. Run ids start with the run's
UTC timestamp, so folders sort chronologically; the last 50 runs are kept
and older run folders are pruned automatically. (Histories written by older
runners as one `runs.yaml` index are migrated to per-run files on first
use.)

Browse the history from the command line:

```sh
testfile-viewer history                   # table of recent runs, newest first
testfile-viewer tui                       # browse runs in the TUI
testfile-viewer history --run 20260801-1046      # one run in detail (id prefix is ok)
testfile-viewer history --run <id> --log         # merged stdout+stderr of the run
testfile-viewer history --run <id> --log all/e2e # ... of a single test
```

The detail view lists every recorded test with status, duration and whether
a log is available. `testfile-viewer` only needs the `.testfile/` folder, so it also
works when the Testfile itself has moved or changed.

Compare two runs (older id first, unique prefixes are enough):

```sh
testfile-viewer history --diff 20260801-1040 20260801-1146
```

The diff lists newly failed, fixed and still-failing tests, tests added to
or removed from the run, and significant duration changes (more than 100ms
and more than 20%) of tests that passed in both runs.

Hunt down flaky tests:

```sh
testfile-viewer history --flaky            # across all recorded runs
testfile-viewer history --flaky --last 10  # only the 10 most recent runs
```

A test is flagged when it both passed and failed across the considered runs
(skipped and aborted outcomes are ignored). The report shows the failure
rate, how often the outcome *flipped* between consecutive occurrences — the
strongest flakiness signal — and the latest status. Flagged tests are good
candidates for a `flaky` tag and a [`retry`](./writing-tests#retries).

## Sharing runs

Because every run is a self-contained `runs/<id>/` folder, runs can move
between machines. `testfile-viewer runs` packs them as `.tgz` archives and brings
them into the local history, where `history`, `--diff`, `--flaky` and the
TUI treat them like local runs:

```sh
testfile-viewer runs pack                       # latest run -> testfile-run-<id>.tgz
testfile-viewer runs pack --run 20260801 -o ci.tgz
testfile-viewer runs import ci.tgz              # import into ./.testfile/runs/
testfile-viewer runs import testfile-run.zip    # a downloaded GitHub run artifact
```

Importing skips runs that already exist locally (same id), so repeated
imports are safe.

With the [aws CLI](https://aws.amazon.com/cli/) configured, runs can be
shared through S3 — for example a CI job pushes, developers pull:

```sh
testfile-viewer runs push s3://my-bucket/testfile-runs        # latest run
testfile-viewer runs push s3://my-bucket/testfile-runs --run 20260801
testfile-viewer runs pull s3://my-bucket/testfile-runs        # newest archive
testfile-viewer runs pull s3://my-bucket/testfile-runs --run <full-id>
```

And when CI is the [GitHub Action](./github-action) (which uploads every
recorded run as a `testfile-run` artifact), `sync` pulls the artifacts of
the latest *n* workflow runs straight into the local history:

```sh
export GITHUB_TOKEN=...                  # a token with actions:read
                                         # (GH_TOKEN works too)
testfile-viewer runs sync owner/repo            # latest 5 workflow runs
testfile-viewer runs sync owner/repo --latest 20
testfile-viewer runs sync owner/repo --artifact my-artifact-name
```

Already-imported runs are skipped, so `sync` is incremental — run it again
any time to top up the local history with the newest CI results. The TUI's
[runs and results views](#runs-view) pick imported runs up live.

## The web viewer

`testfile-viewer serve` starts a small web UI over the recorded runs — the
browser sibling of the TUI:

```sh
testfile-viewer serve          # http://127.0.0.1:7357
testfile-viewer serve --port 8080
```

- **Runs**: a table of all recorded runs; selecting one shows its details,
  per-test results and logs (merged or per test).
- **Results**: every recorded test with aggregated pass/fail counts and
  its executions across all runs.
- The server watches `.testfile/runs/` and pushes changes to the browser,
  so runs recorded elsewhere (another terminal, `testfile-viewer runs sync`)
  appear live.

The server binds to `127.0.0.1` **only** — it is never reachable from the
network. It exposes a read-only REST API for other tooling:
`/api/summary`, `/api/runs`, `/api/runs/<id>`, `/api/runs/<id>/log`
(`?test=<path>` for one test), `/api/results` and `/api/events` (SSE).
The UI itself lives in the `viewer-web/` workspace (React, bundled with
esbuild); `serve` picks up its build automatically.

## Interrupting a run

The first Ctrl+C aborts running tests and shuts down all services through
their configured `stop` behavior (signal, grace period, then SIGKILL;
`podman stop`/`docker stop` for containers). A second Ctrl+C skips the grace
period and kills everything immediately.
