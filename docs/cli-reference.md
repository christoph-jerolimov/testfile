---
title: CLI reference
order: 9
description: Every command and argument of the testfile runner and the testfile-viewer.
---

# CLI reference

The complete list of commands, arguments and options of the two binaries:
[`testfile`](#testfile-the-runner) (the runner — executes suites and writes
run records) and [`testfile-viewer`](#testfile-viewer-the-viewer) (read-only
over the recorded runs in `.testfile/`). For guides and examples see
[CLI & TUI](./cli); this page is the dry inventory.

Conventions used below:

- `[path]` defaults to `.` everywhere. For the runner it is a Testfile or a
  directory containing one (`Testfile`, `testfile.yaml` or `testfile.yml`);
  for the viewer it is a directory containing a `.testfile` folder.
- *(repeatable)* flags can be passed multiple times.
- Every command also accepts `-h, --help`; both binaries accept
  `-V, --version` and `help [command]`.

## `testfile` — the runner

```
testfile [command] [options] [path]
```

Running without a command is the same as `testfile run`. Exit codes:
`0` all tests passed (or everything skipped) · `1` failures or a service
that would not start · `130` interrupted.

### `testfile run [path]`

Run the test suite (the default command).

| Option | Description |
| ------ | ----------- |
| `-v, --verbose` | Also stream service output. |
| `--fail-fast` | Abort the whole run at the first test failure. |
| `--max-parallel <n>` | Global cap on concurrently running tests (group-level `maxParallel` still applies on top). |
| `--dry-run` | Print what would run — with filters applied and predicted [cache](./writing-tests#result-caching) hits marked `[cached]` — without running. |
| `-w, --watch` | Re-run the selection whenever files change ([watch mode](./cli#watch-mode)). |
| `--no-cache` | Ignore cached results; fresh results still refresh the cache. |
| `--forward-env <pattern>` | Forward matching host env vars into the [isolated test env](./env-and-ports#an-isolated-environment), e.g. `"GITHUB_*"` or `"*"`. *(repeatable)* |
| `--reporter <kind>` | Write [machine-readable results](./cli#machine-readable-reports) after the run: `junit` or `json`. |
| `--output <file>` | Report target file, or `-` for stdout (the default). |

Plus the shared [filter options](#shared-filter-options) below.

### `testfile list [path]`

Print the expanded test suite — matrix instances, tags and services
included. Takes the shared [filter options](#shared-filter-options), so it
previews exactly what a filtered `run` would execute.

### Shared filter options (`run` and `list`)

| Option | Description |
| ------ | ----------- |
| `-f, --filter <value>` | Best-guess filter: `key:value` is a matrix filter, anything else matches name/path or tag. *(repeatable)* |
| `-n, --filter-name <name-or-path>` | Only tests whose path contains this (case-insensitive). *(repeatable)* |
| `-t, --filter-tags <tags>` | Only tests tagged — directly or inherited — with any of these comma-separated [tags](./writing-tests#tags). *(repeatable)* |
| `-m, --filter-matrix <key:value>` | Only matrix instances with this value; same key ORs, different keys AND. *(repeatable)* |
| `--failed` | Only tests that failed (or were aborted) in the last recorded run. |
| `--changed` | Only tests whose `inputs` match files [changed against the base branch](./writing-tests#change-based-selection), plus local changes. |
| `--changed-since <ref>` | Base branch/ref for `--changed`, e.g. `origin/main` (implies `--changed`). |

### `testfile tags [path]`

List all [tags](./cli#tags) of the full suite, including
[included Testfiles](./writing-tests#composing-testfiles).

| Option | Description |
| ------ | ----------- |
| `--order <order>` | `alpha` (default), `appearance` (document order) or `count` (most-used first; also reports how many tests have no tag at all). |
| `--json [file]` | Write the tag inventory as JSON, to a file or (without a value) stdout. |

### `testfile changes [path]`

Show the files [changed against the base branch](./cli#changes) — what
`--changed` selects tests from. `path` is the directory (or Testfile) whose
git repository to inspect.

| Option | Description |
| ------ | ----------- |
| `--changed-since <ref>` | Base branch/ref to diff against (default: auto-detected from `origin/HEAD`, then `origin/main`, `origin/master`, `main`, `master`). |
| `--files` | Print only the file paths, one per line. |
| `--json [file]` | Write the changes as JSON, to a file or (without a value) stdout. |

### `testfile validate [path]`

Validate a Testfile against the JSON schema (see
[editor support](./getting-started#4-editor-support) for live validation
while writing). No options.

### `testfile init [path]`

Create a starter Testfile in the given directory (derived from
`package.json` scripts when present). No options.

### `testfile completion <shell>`

Print a completion script for `bash`, `zsh` or `fish` — see
[CLI & TUI](./cli#commands) for how to install it. No options.

## `testfile-viewer` — the viewer

```
testfile-viewer [command] [options] [path]
```

Read-only over the [run history](./cli#run-history) in `.testfile/`;
running without a command is the same as `testfile-viewer runs`.

### `testfile-viewer runs [path]`

List the recorded runs as a table, newest first (the default command).
Sharing subcommands are listed [below](#testfile-viewer-runs-subcommands).

| Option | Description |
| ------ | ----------- |
| `--json [file]` | Write the full run records as JSON, to a file or (without a value) stdout. Combines with `--flaky` for a JSON flakiness report. |
| `--flaky` | Instead of the table: find tests that both passed and failed across recorded runs. |
| `--last <n>` | With `--flaky`: only consider the most recent `n` runs. |

### `testfile-viewer run <id> [path]`

Show one recorded run in detail — a unique id prefix is enough.

| Option | Description |
| ------ | ----------- |
| `--log [test-path]` | Print the run's merged log, or a single test's log. |

### `testfile-viewer diff <older> <newer> [path]`

Compare two recorded runs (older id first, unique prefixes are enough):
newly failed, fixed, still failing, added/removed tests and significant
duration changes. No options.

### `testfile-viewer tui [path]`

Interactive [terminal UI](./cli#the-tui) over the recorded runs; watches
`.testfile/runs/` for new runs.

| Option | Description |
| ------ | ----------- |
| `--view <view>` | Initial view: `runs` (default) or `results`. |
| `--name <name>` | Display name shown in the header. |

### `testfile-viewer serve [path]`

Serve a localhost REST API and the [web viewer](./cli#the-web-viewer) over
the recorded runs.

| Option | Description |
| ------ | ----------- |
| `--port <n>` | Port to listen on, always bound to `127.0.0.1` only (default: `7357`). |
| `--name <name>` | Display name shown in the web viewer. |

### `testfile-viewer runs` subcommands

Pack, [share and sync](./cli#sharing-runs) recorded runs.

#### `runs pack [path]`

Pack a recorded run as a `.tgz` archive.

| Option | Description |
| ------ | ----------- |
| `--run <id>` | Run to pack, id prefix is enough (default: the latest run). |
| `-o, --output <file>` | Target file (default: `testfile-run-<id>.tgz`). |

#### `runs import <archive> [path]`

Import a packed run into the local history. `archive` is a `.tgz` (from
`runs pack`) or a `.zip` (a downloaded GitHub run artifact). Already
imported run ids are skipped. No options.

#### `runs push <s3-prefix> [path]`

Pack a recorded run and upload it to S3 (`s3://bucket/prefix`, uses the
`aws` CLI).

| Option | Description |
| ------ | ----------- |
| `--run <id>` | Run to push, id prefix is enough (default: the latest run). |

#### `runs pull <s3-prefix> [path]`

Download a run archive from S3 into the local history.

| Option | Description |
| ------ | ----------- |
| `--run <id>` | Exact run id to pull (default: the newest archive). |

#### `runs sync <owner/repo> [path]`

Download the run artifacts of recent GitHub Actions workflow runs into the
local history (needs `GITHUB_TOKEN` or `GH_TOKEN` with `actions:read`).

| Option | Description |
| ------ | ----------- |
| `--latest <n>` | Number of recent workflow runs to consider (default: `5`). |
| `--artifact <name>` | Artifact name the action uploads (default: `testfile-run`). |
