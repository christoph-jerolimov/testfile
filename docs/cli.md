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
testfile run --variant platform=linux   # tag the run (for merging later)
testfile validate [path]   # validate against the JSON schema
testfile doctor [path]     # check this machine against what the file needs
testfile list [path]       # print the expanded suite, incl. matrix instances
testfile completion bash   # shell completions (bash, zsh, fish)

# the viewer (read-only over .testfile/)
testfile-viewer runs           # table of recorded runs (default command)
testfile-viewer run <id>       # one run in detail
testfile-viewer diff <a> <b>   # compare two runs
testfile-viewer merge <run...> # combine shards / platform runs into one
testfile-viewer tui            # terminal UI: runs + results, watching
testfile-viewer serve          # localhost REST API + web viewer
testfile-viewer archive <cmd>  # pack/import recorded runs as archives
testfile-viewer s3 <cmd>       # push/pull/list runs in an S3 bucket
testfile-viewer github <cmd>   # sync/list GitHub Actions run artifacts
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

## Checking the machine

A Testfile says what a run needs: the tools its commands call, a container
engine, fixed ports, a shell, git for
[change-based selection](./writing-tests#change-based-selection) — and a run
that finds one of them missing says so halfway through, in the log of
whichever test happened to need it first. `testfile doctor` asks the same
questions up front, and only the ones this file actually raises:

```sh
$ testfile doctor
✔ Testfile                   /home/me/app/Testfile
✔ node                       v22.14.0
✔ git                        git version 2.43.0
✔ shell (sh)                 on PATH
✔ command (npm)              /usr/local/bin/npm
✘ command (pytest)           not found on PATH
  ↳ used by app/tests/unit - install it, or use a path to it
✘ command (./scripts/e2e.sh) /home/me/app/scripts/e2e.sh is missing or not executable
  ↳ used by app/tests/e2e - check the path, or chmod +x it
✘ container engine (docker)  installed, but "docker info" failed: Cannot connect to the Docker daemon
  ↳ is the Docker daemon running?
✘ port web                   8080 is already in use
  ↳ stop what listens on 8080, or declare "web: random" and template the value
✔ .testfile/                 /home/me/app/.testfile is writable

4 failed, 0 warning(s), 11 checks
```

What it looks at:

| Check | Fails when |
| ----- | ---------- |
| `node` | the Node.js running the CLI is older than 20 |
| `git` | *warns* when git is missing or the folder is not inside a work tree — only `--changed` and `testfile changes` need it |
| `shell (…)` | a shell a test invokes (`sh` by default, or its `shell:`) cannot be started |
| `command (…)` | an executable a `command:` starts is not on `PATH`, or the path it names is missing or not executable — see below |
| `container engine` | the file starts containers and no engine is installed, or the engine is installed but not responding. Files without containers only get a note |
| `port …` | a fixed `ports:` entry is already taken. `random` ports are allocated per run and never clash |
| `.testfile/` | recorded runs cannot be written |

### Which commands are looked up

Every `command:` in the file — tests, `setup`/`teardown` hooks, services and
their `ready.exec` probe — contributes the executable it starts. A line is
split at `&&`, `||`, `;` and `|`, so `cd app && pytest -q` looks for `pytest`,
and a leading `FOO=bar` assignment is stepped over. A name without a
separator is looked up on `PATH`; anything with one is resolved against the
test's `workdir` and must be an executable file.

Four things are deliberately *not* looked up, because the answer would say
nothing about whether the run works:

- **shell builtins and keywords** (`cd`, `echo`, `test`, `for`, …),
- **commands that only exist at run time** — a first word containing a
  `${{ … }}` template, a `$VAR`, a substitution or quotes,
- **bodies that run in a container** (a `container:` on the test or an
  ancestor): those executables live in the image, not on this machine,
- **`script:` blocks and tests with a custom `shell:`** — a shell program is
  not a command, and another shell has its own builtins.

`--json` writes the same as `{status, checks: […]}` for scripts, and the
exit code is `1` when a check failed — warnings alone keep it `0`, so
`testfile doctor && testfile run` is a usable pre-flight.

## Labelling runs

A recorded run can carry **labels**, so it can be found again in a history
that mixes branches, pull requests and nightlies:

```sh
testfile run --label branch=main --label tier=nightly
testfile run -l pr=42
```

`-l/--label` takes a `key=value` pair, split at the **first** `=` so a
value may contain more, and is repeatable. Both halves are trimmed, and a
key may only be given once — `-l branch=main -l branch=other` is an error
rather than a silent choice between the two.

They land in the run's `run.yaml` as a map of strings:

```yaml
labels:
  branch: main
  pr: "42"
```

Values are always strings, including numeric-looking ones. Merging a set
of runs keeps the union of their labels; where two runs disagree on a key
the first one wins, because what actually differs between the legs of a
matrix belongs in [`--variant`](#merging-runs).

Viewers show them (`testfile-viewer run <id>`, the TUI's run detail, the
web viewer's run detail) and both filter by them —
[`runs --filter-label`](#run-history) on the command line, a Labels chip
row in the browser. The
[GitHub Action](./github-action#what-a-ci-run-is-labelled-with) labels
every run it records with its branch, pull request, actor and how it was
triggered.

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
[included Testfiles](./writing-tests#composing-testfiles) and matrix
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

## Sharding across machines

Large suites split across CI machines with `--shard i/n`: every shard runs
the same command with a different index and executes its share of the
selected tests.

```sh
testfile run --shard 1/4      # on machine 1
testfile run --shard 2/4      # on machine 2, ...
```

Each shard computes the same split from the same suite, so no coordination
between machines is needed. When the local [run history](#run-history)
knows how long tests took, the split is **time-balanced** (longest test
first into the emptiest shard) instead of by count:

```
shard 1/3: 1 of 6 tests, ~611ms of recorded work
shard 3/3: 3 of 6 tests, ~48ms of recorded work
```

On a fresh machine without history — the usual CI case — the tests are
dealt round-robin in suite order. To get balancing there, restore
`.testfile/` from a cache or import a previous run first
([`archive import`](#sharing-runs), [`github sync`](./github-action#bringing-ci-runs-home)).

Sharding composes with the filters: `-t slow --shard 2/3` shards only the
slow tests. Each shard records its own run — combine them into a single
result with [`merge`](#merging-runs).

## Merging runs

Sharding and a matrix of CI jobs both leave you with several run folders
for what is conceptually one run. `testfile-viewer merge` combines them:

```sh
# shards: each ran a different part of the suite
testfile-viewer merge shard-1 shard-2 shard-3

# CI artifacts, each unpacked into its own folder
testfile-viewer merge downloaded/testfile-run-*
```

The result is an ordinary run — one verdict, one duration, the union of
the tests — that every viewer shows like any other:

```
merged run 20260805-101500-merged
  passed  20260805-101500-a1c3  [platform=ubuntu-latest]  1m12s
  failed  20260805-101501-c3e5  [platform=windows-latest] 1m45s
failed (exit code 1), 24 tests, 2m57s
```

Nothing is hidden: the merged run records which runs went into it, and
every test says which one it came from.

### Variants

Shards merge as they are, because no test appears twice — the group nodes
around them are folded into one entry rather than reported as a clash. Jobs that run the
**same** suite in different places do not — the merge would not know which
`ci/unit` came from where. Tell the runs apart with `--variant`:

```sh
testfile run --variant platform=linux        # on the Linux job
testfile run --variant platform=windows      # on the Windows job
```

Variants are free-form `key=value` pairs, recorded in `run.yaml` and shown
by the CLI, the TUI and the web viewer. Merging requires `path` +
`variants` to be unique and refuses the merge otherwise:

```
✘ runs 20260805-101500-a1c3 and 20260805-101501-c3e5 both recorded "ci/unit"
  - give the runs distinct --variant values (e.g. --variant platform=linux)
```

The [three-platform guided tour](./three-platforms) walks through the
whole setup in GitHub Actions.

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
the status/duration/log of every test that ran. Each test also records
**when** it started — `startedAt` as a timestamp and `startedAfterMs` as
the distance from the start of the run — so a run can be laid out on a
timeline without guessing. Run ids start with the run's
UTC timestamp, so folders sort chronologically; the last 50 runs are kept
and older run folders are pruned automatically. (Histories written by older
runners as one `runs.yaml` index are migrated to per-run files on first
use.)

Browse the history from the command line:

```sh
testfile-viewer runs                      # table of recent runs, newest first
testfile-viewer runs --json               # ... as JSON (or --json runs.json)
testfile-viewer tui                       # browse runs in the TUI
testfile-viewer run 20260801-1046         # one run in detail (id prefix is ok)
testfile-viewer run <id> --log            # merged stdout+stderr of the run
testfile-viewer run <id> --log all/e2e    # ... of a single test
```

A history that collects runs from every branch and every CI job gets long,
so `runs` narrows it:

```sh
testfile-viewer runs --filter-status failed
testfile-viewer runs --filter-label branch=main --filter-label branch=release
testfile-viewer runs --filter-label pr            # any run that has a pr label
testfile-viewer runs --filter-variant platform=windows
```

Several values of one filter are an **OR** (`branch=main` *or*
`branch=release` above), different filters an **AND**, and an unused
filter narrows nothing. `--filter-label` takes a whole
[label](#labelling-runs) or just its key — the key alone asks whether the
run carries that label at all, which is how you find every pull-request
run. `--filter-variant` also matches the legs of a
[merged run](#merging-runs), so a merged matrix is found by any platform
that went into it. The filters apply to the table, to `--json` and to the
`--flaky` report alike, and the footer says how much survived
(`3 of 12 runs`).

The detail view lists every recorded test with status, when it started
(`+2.3s` into the run), duration and whether a log is available, and ends
with a `timeline:` block — one fixed-width bar per test, so a sequence
reads as a staircase and a parallel group as a stack:

```
timeline:
  ci        |████████████████████████| 0ms+3.2s
  ci/build  |█                       | 60ms+40ms
  ci/unit   | ███████████████████████| 120ms+2.9s
```

`testfile-viewer` only needs the `.testfile/` folder, so it also works when
the Testfile itself has moved or changed.

Compare two runs (older id first, unique prefixes are enough):

```sh
testfile-viewer diff 20260801-1040 20260801-1146
```

The diff lists newly failed, fixed and still-failing tests, tests added to
or removed from the run, and significant duration changes (more than 100ms
and more than 20%) of tests that passed in both runs.

Hunt down flaky tests:

```sh
testfile-viewer runs --flaky               # across the recorded history
testfile-viewer runs --flaky --last 10     # narrowed to the 10 most recent runs
```

What a test did fifty runs ago says nothing about it now, so the verdict is
decided on the **20 most recent** results per test — and below **10** there
is not enough evidence to say anything at all. The same rule runs in the
CLI, the TUI and the web viewer:

| Failure rate of the sample | Verdict |
| --- | --- |
| fewer than 10 results | *no verdict* |
| below 25% | healthy |
| 25% to 75% | **flaky** |
| above 75% | **broken** |

Both verdicts are reported: a broken test is not flaky — it fails almost
every time — but it is just as untrustworthy, and the report's flip count
(how often the outcome changed between consecutive results) tells the two
apart at a glance. The report also shows the failure rate over the sample
and the latest status. Flagged tests are good candidates for a `flaky` tag
and a [`retry`](./writing-tests#retries).

`skipped` and `aborted` results are not evidence and never enter the
sample: a skip says the test never ran, and one Ctrl+C aborts everything
in flight, which would otherwise make a whole suite look flaky at once.
Age is not a criterion — a long-untouched project keeps its verdicts, and
`--last <n>` narrows the history when you only care about recent runs.

## Sharing runs

Because every run is a self-contained `runs/<id>/` folder, runs can move
between machines. `testfile-viewer archive` packs them as `.tgz` archives and
brings them into the local history, where `runs`, `run`, `diff`, `--flaky`
and the TUI treat them like local runs:

```sh
testfile-viewer archive pack                    # latest run -> testfile-run-<id>.tgz
testfile-viewer archive pack --run 20260801 -o ci.tgz
testfile-viewer archive import ci.tgz           # import into ./.testfile/runs/
testfile-viewer archive import testfile-run.zip # a downloaded GitHub run artifact
```

Importing skips runs that already exist locally (same id), so repeated
imports are safe.

Packing and importing shell out to `tar`, and importing a zip (a CI
artifact) additionally needs `unzip` on the `PATH`. Both are a given on
Linux and macOS; on Windows `tar` ships with the system but `unzip` does
not, so zip artifacts need it installed. Everything else in the viewer —
`runs`, `run`, `diff`, `tui`, `serve` — is pure Node.

With the [aws CLI](https://aws.amazon.com/cli/) configured, runs can be
shared through S3 — for example a CI job pushes, developers pull:

```sh
testfile-viewer s3 push s3://my-bucket/testfile-runs          # latest run
testfile-viewer s3 push s3://my-bucket/testfile-runs --run 20260801
testfile-viewer s3 list s3://my-bucket/testfile-runs          # available archives
testfile-viewer s3 pull s3://my-bucket/testfile-runs          # newest archive
testfile-viewer s3 pull s3://my-bucket/testfile-runs --run <full-id>
```

And when CI is the [GitHub Action](./github-action) (which uploads every
recorded run as a `testfile-run` artifact), `sync` pulls the artifacts of
the latest *n* workflow runs straight into the local history. The artifact
name is a **prefix**, so a [matrix over platforms](./three-platforms) —
`testfile-run-ubuntu-latest`, `testfile-run-macos-latest`,
`testfile-run-merged` — comes along without naming each leg:

```sh
export GITHUB_TOKEN=...                  # a token with actions:read
                                         # (GH_TOKEN works too)
export GITHUB_TOKEN=$(gh auth token)     # ... or reuse the gh CLI's login
testfile-viewer github list owner/repo          # available run artifacts
testfile-viewer github sync owner/repo          # latest 100 workflow runs
testfile-viewer github sync owner/repo --latest 20
testfile-viewer github sync owner/repo --artifact testfile-run-merged
testfile-viewer github sync owner/repo --artifact testfile-run --exact
```

Already-imported runs are skipped, so `sync` is incremental — run it again
any time to top up the local history with the newest CI results. The TUI's
[runs and results views](#the-tui) pick imported runs up live.

## The web viewer

`testfile-viewer serve` starts a small web UI over the recorded runs — the
browser sibling of the TUI:

```sh
testfile-viewer serve          # http://127.0.0.1:7357
testfile-viewer serve --port 8080
```

- **Runs**: a table of all recorded runs; selecting one shows its details,
  the suite tree with this run's results on it, and the logs (merged or per
  test).
- **Results**: every recorded test with aggregated pass/fail counts and
  its executions across all runs.
- **Logs** read like logs: the colour a tool wrote (the runner asks for it —
  see [an isolated environment](./env-and-ports#an-isolated-environment)) is
  rendered rather than printed as escape sequences, and every log has a
  `find in log` box with `‹ ›` to walk the hits, a `wrap` toggle (on by
  default) and a `follow` toggle that pins the view to the end while a run
  is still being written.
- The server watches `.testfile/runs/` and pushes changes to the browser,
  so runs recorded elsewhere (another terminal, `testfile-viewer github sync`)
  appear live.

Above the tree, the run detail draws a **timeline**: one bar per test on a
single axis, from the start of the run to its end, coloured by outcome —
the shape of the run rather than a list of durations. A sequence reads as
a staircase, a parallel group as a stack, and a merged run shows what its
legs did at the same moment (`merge` recomputes each leg's offsets against
the merged start, so one axis holds them all). Clicking a bar opens that
test's log. Records written before the runner timed its tests simply have
no timeline.

The run detail draws the **suite tree** the record carries: every node of
the Testfile with its kind, tags, matrix combination and declared services,
indented, with the results of this run on it. Groups collapse (and
`collapse all` / `expand all` do the lot), a merged run shows one line per
leg under its node, and a test the run never reached — filtered out,
skipped by a condition, or never started because something before it
failed — keeps its place, greyed and marked `not run`. Records written
before `suite` existed fall back to the tree their test paths imply.

Both tables have a filter bar above them. Nothing is selected in the
multi-selects to begin with, which shows everything; the only default that
narrows anything is the time window:

| Filter | Applies to | Default |
| ------ | ---------- | ------- |
| **Started** | runs — `7 days`, `30 days`, `90 days`, `all` | last **30 days** |
| **Status** | runs / tests, multi-select (several values are an OR) | everything |
| **Variants** | runs, multi-select over `platform=linux`-style labels; a merged run matches when *any* of its legs does | everything |
| **Tags** | tests, multi-select over the tags of the recorded [suite tree](https://github.com/christoph-jerolimov/testfile/blob/main/spec/RESULTS.md) — nested tests inherit the tags of their groups | everything |
| **flaky only** | tests, an on/off chip: keeps only tests the [flaky rule](#run-history) calls flaky — 25% to 75% of their last 20 results failed. Broken tests are badged but not matched by this chip | off |
| **Search** | free text over run ids, test paths, statuses and variant labels | empty |

Every column of every table sorts: the header is a button, clicking it
flips between ascending and descending, and the arrow shows which column
the table is ordered by. The runs table opens newest first, the tests
table by path, and each table remembers its own order — the suite tree is
the one exception, because sorting a tree would take it apart.

The count on the right says how much survived (`4 of 27 runs`) and clears
the filters again. A run or test opened by link stays visible even when the
filters would hide it — the link should not silently open something else.

The two views the CLI already had are on the same pages. In **Results**,
each test carries a **history sparkline** — one block per recorded run,
newest on the right, so a test that alternates green and red looks
different from one that simply broke — and a `flaky` or `broken` badge
next to the tests `testfile-viewer runs --flaky` would list, decided by
exactly the same rule. A test with fewer than 10 results gets no badge at
all. The sparkline still draws the whole history, so the badge and the
blocks can legitimately disagree about an old bad patch. The `flaky only`
chip narrows the table to the flaky ones. In **Runs**, a run detail has a *compare with*
picker: choose another recorded run (or press `previous run` for the one
recorded before this one) and the same six sections
`testfile-viewer diff a b` prints appear above the suite tree — newly
failed, still failing, fixed, added, removed, and durations that moved by
more than 100ms *and* more than a fifth. In a merged run the worst leg of a
path decides, exactly as the run's own verdict does.

Every selection is in the URL, so a view can be linked, bookmarked and
reloaded — and the browser's back button walks through it:

| Path | Shows |
| ---- | ----- |
| `/` or `/runs` | the runs table with the newest run |
| `/runs/<id>` | that run's detail |
| `/results` | the results table |
| `/results/<test/path>` | that test's executions — the test path keeps its slashes, so the URL reads like the test does |

An id or test path that no longer exists falls back to the newest run
(respectively the first test) instead of an error page.

Whatever a run kept can be opened from the page: the artifacts of a test
are links in its row, and the run detail links `run.yaml` — the record the
page was built from — and `junit.xml` when the run wrote one. They all go
through one endpoint, addressed exactly as `run.yaml` records the path:

```
/api/runs/<id>/artifacts/artifacts/ci-unit/report.txt
/api/runs/<id>/artifacts/junit.xml
/api/runs/<id>/artifacts/run.yaml
```

It reads from that one run folder and nowhere else: the id is checked as
it is everywhere else, each path segment is decoded and rejected if it is
`.`, `..`, or hides a separator, and the resolved path has to still be
inside the folder. Nothing is served as HTML or JavaScript, so a recorded
artifact can never run as a page on the viewer's own origin.

The server binds to `127.0.0.1` **only** — it is never reachable from the
network. It exposes a read-only REST API for other tooling:
`/api/summary`, `/api/runs`, `/api/runs/<id>`, `/api/runs/<id>/log`
(`?test=<path>` for one test), `/api/runs/<id>/artifacts/<path>`,
`/api/results` and `/api/events` (SSE).
The UI itself lives in the `viewer-web/` workspace (React, bundled with
esbuild); `serve` picks up its build automatically.

## Interrupting a run

The first Ctrl+C aborts running tests and shuts down all services through
their configured `stop` behavior (signal, grace period, then SIGKILL;
`podman stop`/`docker stop` for containers). A second Ctrl+C skips the grace
period and kills everything immediately.
