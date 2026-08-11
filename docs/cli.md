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
testfile init [path]         # create a starter Testfile (from what the project has)
testfile start [path]        # run the test suite (default command)
testfile start --verbose     # also stream service output
testfile start --fail-fast   # abort everything at the first failure
testfile start --max-parallel 4   # global cap on concurrently running tests
testfile start --dry-run     # print what would run, without running
testfile start --watch       # re-run on file changes
testfile start --reporter junit --output results.xml   # report for CI
testfile start --variant platform=linux   # tag the run (for merging later)
testfile validate [path]     # validate against the JSON schema
testfile doctor [path]       # check this machine against what the file needs
testfile inspect [path]      # print the expanded suite, incl. matrix instances
testfile tags [path]         # list the tags the suite uses
testfile changes [path]      # which tests a change selection would run
testfile completion bash     # shell completions (bash, zsh, fish)

# the viewer (read-only over .testfile/)
testfile-viewer runs               # table of recorded runs (default command)
testfile-viewer inspect run <id>   # one run in detail
testfile-viewer diff <a> <b>       # compare two runs
testfile-viewer merge <run...>     # combine shards / platform runs into one
testfile-viewer tui                # terminal UI: runs + tests, watching
testfile-viewer serve              # localhost REST API + web viewer
testfile-viewer archive <cmd>      # pack/import recorded runs as archives
testfile-viewer s3 <cmd>           # push/pull/list runs in an S3 bucket
testfile-viewer github <cmd>       # sync/list GitHub Actions run artifacts
testfile-viewer gitlab <cmd>       # sync/list GitLab CI job artifacts
```

Tab completion for commands and flags:

```sh
source <(testfile completion bash)                        # bash
testfile completion zsh > "${fpath[1]}/_testfile"         # zsh
testfile completion fish > ~/.config/fish/completions/testfile.fish
```

`--no-cache` ignores [cached results](./writing-tests#result-caching) for
tests with `inputs` (fresh results still refresh the cache).
`--engine` picks the container engine for the run — `podman`, `docker` or
`kubernetes`; without it `TESTFILE_ENGINE` decides, and without either the
first engine that responds is used ([how selection works](./services#containers)).
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
✘ container engine (podman)      not installed
✘ container engine (docker)      installed, but "docker info" fails: Cannot connect to the Docker daemon
  ↳ is the Docker daemon running?
✘ container engine (kubernetes)  kubectl not installed
✘ engine selection               this Testfile starts containers, but no engine responds
  ↳ install/start podman or docker, or point kubectl at a cluster
✘ port web                   8080 is already in use
  ↳ stop what listens on 8080, or declare "web: random" and template the value
✔ .testfile/                 /home/me/app/.testfile is writable

7 failed, 0 warning(s), 13 checks
```

What it looks at:

| Check | Fails when |
| ----- | ---------- |
| `node` | the Node.js running the CLI is older than 20 |
| `git` | *warns* when git is missing or the folder is not inside a work tree — only `--changed` and `testfile changes` need it |
| `shell (…)` | a shell a test invokes (`sh` by default, or its `shell:`) cannot be started |
| `command (…)` | an executable a `command:` starts is not on `PATH`, or the path it names is missing or not executable — see below |
| `container engine (…)` | one row per engine — podman, docker and kubernetes are all checked, and the first responding one is marked as what [a run would use](./services#containers). An engine that is installed but not responding (daemon down, no reachable cluster) is a warning while another covers the run, a failure when it is the pinned or only one. Files without containers only get a note |
| `engine selection` | the file starts containers but no engine responds, or `TESTFILE_ENGINE` pins an engine that does not |
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
`testfile doctor && testfile start` is a usable pre-flight.

## Labelling runs

A recorded run can carry **labels**, so it can be found again in a history
that mixes branches, pull requests and nightlies:

```sh
testfile start --label branch=main --label tier=nightly
testfile start -l pr=42
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

Viewers show them (`testfile-viewer inspect run <id>`, the TUI's run detail, the
web viewer's run detail) and both filter by them —
[`runs --filter-label`](#run-history) on the command line, a Labels chip
row in the browser. The
[GitHub Action](./github-action#what-a-ci-run-is-labelled-with) labels
every run it records with its branch, pull request, actor and how it was
triggered.

## Machine-readable reports

For CI systems, `--reporter` writes the run's result after it finished:

```sh
testfile start --reporter junit --output results.xml
testfile start --reporter json --output results.json
testfile start --reporter json           # ... or to stdout
```

The JUnit XML contains one `<testcase>` per **leaf** test — its name is the
last path segment, the parent path becomes the classname; groups aggregate,
they don't get testcases — with `<failure>` elements carrying the merged
log and `<skipped/>` markers; the JSON report is the same record that the
run's `run.yaml` stores. In watch mode the report is rewritten after every
re-run.

### Streaming events while the run happens

`--reporter` speaks once, at the end. `--json-stream` speaks throughout:
one JSON object per line (NDJSON) on stdout, written as the run happens,
so a tool — or an agent supervising a long suite — can react to the first
failure instead of waiting for a summary.

```sh
testfile start --json-stream | jq -c 'select(.event == "test-end" and .status == "failed")'
```

| Event | Fields |
| ----- | ------ |
| `run-start` | `selected` (how many tests), `at` |
| `test-start` | `path`, `kind` |
| `line` | `path` *or* `service`, `stream` (`stdout`/`stderr`/`system`), `text` |
| `test-end` | `path`, `status`, `durationMs`, `cached`, `reason`, `error` |
| `service` | `name`, `status`, `error` — once per status change |
| `run-end` | `status`, `exitCode`, `runId`, `counts` (per status, leaves only), `at` |

Fields that don't apply are left out rather than sent as null, and new
events and fields may be added — a consumer must ignore what it doesn't
know. Service output is only streamed with `-v`, as in a normal run.
Because stdout belongs to the stream, everything written for a human goes
to stderr; combining it with a `--reporter` that also writes to stdout is
an error, so give the report a file (`--output results.json`).

What the inspection commands print is available as JSON too, through the
same `--json [file]` flag: a file name writes there, the bare flag writes
to stdout, so a command can be piped straight into `jq`. (The commands
below all take it; action commands like `merge`, `serve` or the sync
commands don't.)

```sh
testfile inspect --json | jq '.tests[].path'   # what a filtered run would execute
testfile validate --json                       # {path, valid} - or the errors
testfile tags --json                           # the tag inventory
testfile changes --json                        # what --changed selects from
testfile doctor --json checks.json             # machine status of this machine

testfile-viewer runs --json                    # the recorded runs
testfile-viewer inspect run <id> --json        # one run record, in full
testfile-viewer diff <a> <b> --json            # what changed between two runs
testfile-viewer s3 list <prefix> --json        # ... and github/gitlab list
```

## Watch mode

`testfile start --watch` (or `-w`) re-runs the current selection whenever a
file in the project changes — combined with filters (`-w -t fast`) it makes
a tight edit-test loop:

```sh
testfile start -w -f unit
```

Changes are debounced, edits made while a run is in progress trigger one
re-run afterwards, and `.git/`, `node_modules/` and `.testfile/` are
ignored. Every re-run is recorded in the history like a normal run. Ctrl+C
while idle exits with the last run's exit code; during a run it stops the
run first.

`path` may be a Testfile or a directory containing one (`Testfile`,
`testfile.yaml` or `testfile.yml`); it defaults to the current directory.

Exit codes: `0` all tests passed (or everything skipped) · `1` failures or
a service that would not start · `130` interrupted.

## Filtering

`start` and `inspect` accept filters to work on a subset of the suite:

```sh
testfile start -f e2e                          # best guess: name, tag, ...
testfile start -f fast                         # ... tag ...
testfile start -f db:postgres                  # ... or matrix (it has a ":")
testfile start --filter-name all/checks/unit   # -n: match name/path only
testfile start --filter-tags "slow, nightly"   # -t: tagged slow OR nightly
testfile start --filter-matrix db:postgres     # -m: only these matrix instances
testfile start -t slow -m db:postgres -m node:22
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
filters, works on `inspect` for preview, and errors when nothing is selected.
`--changed-since <ref>` picks the base branch (default: the remote's
default branch) and implies `--changed`. Selected tests log which pattern
matched how many changed files, and record it as `reason` in `run.yaml`.

`--failed` re-runs what broke last time: it keeps only tests that failed (or
were aborted) in the most recent recorded run, and combines with the other
filters — `testfile start --failed -t integration` re-runs only the failed
integration tests.

Different filter kinds are ANDed. Filters that match nothing are an error.
`testfile inspect` shows each test's tags, so it's an easy way to preview what
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
testfile start --shard 1/4      # on machine 1
testfile start --shard 2/4      # on machine 2, ...
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
testfile start --variant platform=linux        # on the Linux job
testfile start --variant platform=windows      # on the Windows job
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
`testfile inspect --changed` or `testfile start --changed --dry-run`.

## Plain output

`testfile start` streams progress line by line — suitable for CI
logs. Test output is prefixed with `[test name]`; service output is shown
with `--verbose`, and the tail of a failing service's log is always printed.
A nested summary with per-test durations is printed at the end.

## The TUI

`testfile-viewer tui` opens a read-only terminal UI over the recorded runs
(it never starts tests — that is `testfile start`'s job). It is a
multi-page interface, mirroring the [web viewer](#the-web-viewer): pages
navigate forward, `esc` walks back, and a breadcrumb on top says where you
are.

The **index page** has two tabs, switched with `tab` (or `1`/`2`):

1. **Runs** — a table of every recorded run (started, run id, status,
   duration, passed/failed counts, the remaining statuses spelled out, and
   variants), filtered with `/`, taking the full terminal width. Enter (or
   a click) on a row opens that run's page.
2. **Tests** — two tables side by side. The left lists every test path
   that ever ran (plus an "All tests" row on top) and acts as the filter;
   the right lists the matching executions across all runs. `←`/`→` (or
   enter and `esc`) jump between the tables; enter or a click on an
   execution opens that test page.

The **run page** shows the suite as a tree table on the left — the run's
tests with status, duration and start offset, groups indented — and, for
the selected row, a tab view on the right: *Overview* (the run or test
metadata, ending with the last 20 lines of the log), *Log* (the merged run
log, or the selected test's log) and one tab per related service log. The
**test page** (one test in one run) shows the same tab view full width;
both pages breadcrumb their way back — and walking back with `esc` lands
exactly where you left: the same cursor row, scroll position and tab.

Every table sorts: `s` cycles the sort column, `r` reverses it, and the
header shows `▲`/`▼`. `↑`/`↓`, PgUp/PgDn, `g`/`G` and the mouse wheel move
the cursor; clicking a row selects it. Log panes have a visible cursor
line: `↑`/`↓` move it (the view scrolls with it), `shift+↑`/`↓` grow a
selection, `ctrl-c` copies the selection to the clipboard (OSC 52 — the
terminal has to allow it), `←`/`→` pan long lines, `w` toggles wrapping,
and `/` searches (walk the hits with `n`/`N`). In tab views, `tab` cycles
the tabs.

The status line at the bottom always lists the shortcuts of whatever is
focused; `?` opens an overlay with every shortcut on the page. `q` (or
`ctrl-c`) quits.

On terminals narrower than 80 columns the side-by-side panels collapse:
only the left table is shown, and enter opens the details as their own
page instead.

Every page watches `.testfile/runs/` — runs recorded by other processes
(say, a `testfile start` in a second terminal, or a `testfile-viewer
github sync`) appear live. `--view tests` opens on the Tests tab
(`--view results` still works as an alias).

## Run history

Every `testfile start` is recorded in a `.testfile/` folder next to
the Testfile (the folder ignores itself via a generated `.gitignore`). Each
run is a self-contained folder:

```
.testfile/
  runs/<run-id>/
    run.yaml            # the run's record
    junit.xml           # the run as JUnit XML, for CI tooling
    tests/<test>.log    # merged stdout+stderr per test
    services/<svc>.log  # log of each started service
    artifacts/<test>/…  # files collected via `artifacts:`
```

`run.yaml` stores the run's start time, duration, status
(passed/failed/aborted), exit code, whether it was cancelled, the env
variables and ports provided by the Testfile, which tests were selected,
the [labels and variants](#labelling-runs) attached to the run, the
Testfile's whole test tree (`suite`, including tests this run did not
execute), the started services, and the status/duration/log of every test
that ran. Each test also records **when** it started — `startedAt` as a
timestamp and `startedAfterMs` as the distance from the start of the run —
so a run can be laid out on a timeline without guessing. Run ids start
with the run's UTC timestamp (second granularity — order runs by
`startedAt` when it matters); the last 50 runs are kept and older run
folders are pruned automatically. (Histories written by older runners as
one `runs.yaml` index are migrated to per-run files on first use.)

Browse the history from the command line:

```sh
testfile-viewer runs                             # table of recent runs, newest first
testfile-viewer runs --json                      # ... as JSON (or --json runs.json)
testfile-viewer tui                              # browse runs in the TUI
testfile-viewer inspect run 20260801-1046        # one run in detail (id prefix is ok)
testfile-viewer inspect run <id> --log           # merged stdout+stderr of the run
testfile-viewer inspect run <id> --log all/e2e   # ... of a single test
testfile-viewer inspect run <id> --json          # the whole record, for a script
testfile-viewer explain                          # what failed in the latest run, and why
testfile-viewer repro <id> all/e2e               # everything needed to reproduce one failure
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
and more than 20%) of tests that passed in both runs. `--json` writes the
same lists as `{base, compare, newlyFailed, fixed, stillFailing, added,
removed, durations}`, which is enough to post a comment from CI.

### Digesting a run

`explain` answers the three questions a red run raises — what failed, why,
and what changed — in one bounded piece of markdown:

```sh
testfile-viewer explain                        # the latest run
testfile-viewer explain 20260801-1146          # a particular one
testfile-viewer explain --max-failures 3 --log-lines 10
testfile-viewer explain --json                 # the same digest, structured
```

Each failure carries its reason, the end of its log and what the history
says about it — a test that fails half the time is a different problem
from one that just broke, so the digest says `known flaky — 6/12 of its
recent results failed` rather than only `failed`. The verdict is the same
[flaky rule](#run-history) the rest of the tooling uses.

A group fails because something under it failed, so the leaves come first
and the groups are the first to go when the digest has to be shorter:
`--max-failures` bounds how many failures are detailed (10 by default),
`--log-lines` how much log each one gets (20). What is left out is
counted, never silently dropped. Log excerpts are stripped of colour —
in a PR comment or a prompt, escape sequences are noise.

The run before this one is compared automatically, so the digest opens
with `newly failing` / `still failing` / `fixed` before it gets to the
detail.

### Reproducing a failure

A red test in CI is a puzzle assembled from several places: which run,
which leg of a matrix, what environment, which services were up, what the
log said. `repro` puts it in one place — and gives the command that reruns
exactly that test, not the whole suite:

```sh
testfile-viewer repro 20260801-1146 ci/e2e
testfile-viewer repro <id> ci/e2e --variant platform=windows   # one leg of a merged run
testfile-viewer repro <id> ci/e2e --json                       # for a tool or an agent
```

```
# reproduce ci/e2e from run 20260801-114600-9f2c

status:    failed (cache miss: src/**: 1 changed file)
recorded:  2026-08-01T11:46:00.000Z on ci-linux
labels:    branch=main, pr=42
matrix:    browser=firefox
tags:      ci, slow

run it with:

  export DATABASE_URL=postgres://localhost:5432/test
  testfile start -n ci/e2e -m browser:firefox

services this test needs (status in the recorded run):
  db — stopped

the end of its log:

  boom: expected 4 to equal 5
```

Everything comes from the run's own record — the viewer never reruns
anything and never guesses, so what the run did not record does not
appear. The environment leaves out what every run sets anyway (`CI`,
`FORCE_COLOR`, `TESTFILE_OS`): what is left is what was special about
this one. On a [merged run](#merging-runs) a path has one result per leg;
`--variant` picks one, and without it a failing leg is chosen, since that
is the one worth reproducing.

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
brings them into the local history, where `runs`, `inspect run`, `diff`, `--flaky`
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
`runs`, `inspect run`, `diff`, `tui`, `serve` — is pure Node.

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
[runs and tests views](#the-tui) pick imported runs up live.

A sync narrates what it does as it works: what it is listing, how many
artifacts it found (and their size, when the API says), and a
`[3/12] testfile-run-macos-latest (workflow run …) …` progress line per
download that tells what each artifact yielded — on a terminal the
in-flight line updates in place, piped output gets plain lines. The same
narration covers `gitlab sync` and `s3 pull`; the final summary of
imported and skipped runs is unchanged.

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
- **Tests**: every recorded test with aggregated pass/fail counts and
  its executions across all runs; clicking an execution opens its own
  page — that test in that run, with an overview, the test's log and one
  tab per related service log. On a merged run the page shows every leg:
  one `Test log (platform=linux)`-style tab per leg (services too, when
  the legs recorded them), and the overview repeats the run's labels and
  ends with the last 20 lines of each leg's log — where a failure
  usually says why.
- **Logs** read like logs: the colour a tool wrote (the runner asks for it —
  see [an isolated environment](./env-and-ports#an-isolated-environment)) is
  rendered rather than printed as escape sequences, and every log has a
  `find in log` box with `‹ ›` to walk the hits, a `wrap` toggle (on by
  default) and a `follow` toggle that pins the view to the end while a run
  is still being written.
- The server watches `.testfile/runs/` and pushes changes to the browser,
  so runs recorded elsewhere (another terminal, `testfile-viewer github sync`)
  appear live.
- The page follows the system theme — dark and light are both first-class
  (without a preference it stays dark). The logs theme too: the recorded
  ANSI colours are mapped onto a palette per theme, so a green test line
  is readable on either background.

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
before `suite` existed fall back to the tree their test paths imply. Any
row with a log is clickable as a whole — the `show` link is just its
label — and opens that test's log below the tree.

Both tables have a filter bar above them. Nothing is selected in the
multi-selects to begin with, which shows everything; the only default that
narrows anything is the time window:

| Filter | Applies to | Default |
| ------ | ---------- | ------- |
| **Started** | runs — `7 days`, `30 days`, `90 days`, `all` | last **30 days** |
| **Status** | runs / tests, multi-select (several values are an OR) | everything |
| **Labels** | runs, multi-select over the recorded [labels](#labelling-runs) (`branch=main`-style); a key with more than 3 values becomes a dropdown instead of a chip per value | everything |
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

The two views the CLI already had are on the same pages. In **Tests**,
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
| `/tests` | the tests table |
| `/tests/<test/path>` | that test's executions — the test path keeps its slashes, so the URL reads like the test does |
| `/runs/<id>/tests/<test/path>` | one execution: that test in that run, as its own page |

(The tests tab used to be called *results*; `/results/...` links keep
working.)

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

## Talking to an AI assistant

`testfile-viewer mcp` serves the recorded runs over the
[Model Context Protocol](https://modelcontextprotocol.io), so an assistant
that speaks MCP — Claude Code, Claude Desktop, an agent of your own — can
read the history as data instead of parsing terminal output.

```jsonc
// .mcp.json, or Claude Desktop's config
{
  "mcpServers": {
    "testfile": {
      "command": "testfile-viewer",
      "args": ["mcp", "/path/to/your/project"]
    }
  }
}
```

| Tool | Answers |
| ---- | ------- |
| `list_runs` | recent runs with their status and counts; narrows by status, label or variant |
| `get_run` | one run's full record |
| `explain_run` | [the digest](#digesting-a-run): what failed, why, what changed — where to start when a run is red |
| `repro_test` | [the repro bundle](#reproducing-a-failure) for one failure |
| `get_test_log` | one test's log, whole or its tail |
| `diff_runs` | what changed between two runs |
| `list_tests` | every known test with its pass/fail counts and [verdict](#run-history) |
| `list_flaky` | the tests the flaky rule flags |

**Everything here reads.** There is deliberately no `run_tests` tool: the
viewer does not run tests, and an assistant that wants to is already
holding a shell — `testfile start -n <test>`, or
[`--json-stream`](#streaming-events-while-the-run-happens) to follow a run
live. Keeping the server read-only means connecting it can't change
anything.

The transport is stdio, the history is re-read on every call (a run
recorded while the assistant is connected shows up without a restart), and
a tool that can't answer says so as a result the model can read rather
than as a protocol error it can't.

### Skills

Knowing the commands is not the same as knowing which one to reach for.
This repository ships three [Claude Code skills](https://code.claude.com/docs)
in `.claude/skills/`, which an assistant working in a checkout picks up
automatically:

| Skill | For |
| ----- | --- |
| `testfile-triage` | a red run: which failure is real, what caused it, whether it's worth chasing |
| `testfile-run` | choosing a selection — `--changed` after an edit, `--failed` after a fix, the whole suite before declaring done |
| `testfile-author` | writing or extending a Testfile, including which key replaces a shell workaround |

Copy the folder into any project that uses Testfile; nothing in them is
specific to this repository. They are checked by the suite: every command
and flag a skill names is verified against the CLIs' own `--help`, so a
renamed flag fails the build instead of turning the advice into confident
nonsense.

### Recording what a failure meant

A run says what happened. It cannot say what it *meant* — that three
failures share one cause, that the flake was a port collision, that the
red was infrastructure and not the change. Whoever works that out can
write it into the record, as an optional
[`analysis`](https://github.com/christoph-jerolimov/testfile/blob/main/spec/RESULTS.md#analysis)
field on `run.yaml`:

```yaml
analysis:
  text: |
    All three failures come from the port 5432 collision in the parallel
    group. Not caused by this change.
  author: claude-code
  at: 2026-08-01T12:10:00.000Z
```

`testfile-viewer inspect run`, `explain`, the TUI and the web viewer all
show it next to the run — **marked as somebody's reading of it, never as a
result**: a run whose analysis says "this is fine" is still a failed run.
No runner writes the field and no viewer does either (they are read-only);
whoever did the reading writes it, preserving the rest of the record.
[Letting an assistant read the failure](./github-action#letting-an-assistant-read-the-failure)
shows the CI shape of that loop.

## Interrupting a run

The first Ctrl+C aborts running tests and shuts down all services through
their configured `stop` behavior (signal, grace period, then SIGKILL;
`podman stop`/`docker stop` for containers). A second Ctrl+C skips the grace
period and kills everything immediately.
