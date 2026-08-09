---
title: CLI reference
order: 11
description: Every command and argument of the testfile runner and the testfile-viewer.
---

# CLI reference

The complete list of commands, arguments and options of the two binaries:
[`testfile`](#testfile--the-runner) (the runner — executes suites and writes
run records) and [`testfile-viewer`](#testfile-viewer--the-viewer) (read-only
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

Running without a command is the same as `testfile start`. Exit codes:
`0` all tests passed (or everything skipped) · `1` failures or a service
that would not start · `130` interrupted.

### `testfile start [path]`

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
| `--engine <name>` | Container engine for this run: `podman`, `docker` or `kubernetes`. Default: `$TESTFILE_ENGINE`, else the first of the three that responds. The [Testfile itself never names one](./services#containers). |
| `--reporter <kind>` | Write [machine-readable results](./cli#machine-readable-reports) after the run: `junit` or `json`. |
| `--output <file>` | Report target file, or `-` for stdout (the default). |

Plus the shared [filter options](#shared-filter-options-start-and-inspect) below.

### `testfile inspect [path]`

Print the expanded test suite — matrix instances, tags and services
included. Takes the shared [filter options](#shared-filter-options-start-and-inspect), so it
previews exactly what a filtered `start` would execute.

| Option | Description |
| ------ | ----------- |
| `--json [file]` | Write the suite as JSON (`{path, services, count, tests: [{path, name, kind, tags?, matrix?, services?}]}`), to a file or (without a value) stdout. |

### Shared filter options (`start` and `inspect`)

| Option | Description |
| ------ | ----------- |
| `-f, --filter <value>` | Best-guess filter: `key:value` is a matrix filter, anything else matches name/path or tag. *(repeatable)* |
| `-n, --filter-name <name-or-path>` | Only tests whose path contains this (case-insensitive). *(repeatable)* |
| `-t, --filter-tags <tags>` | Only tests tagged — directly or inherited — with any of these comma-separated [tags](./writing-tests#tags). *(repeatable)* |
| `-m, --filter-matrix <key:value>` | Only matrix instances with this value; same key ORs, different keys AND. *(repeatable)* |
| `--failed` | Only tests that failed (or were aborted) in the last recorded run. |
| `--changed` | Only tests whose `inputs` match files [changed against the base branch](./writing-tests#change-based-selection), plus local changes. |
| `--changed-since <ref>` | Base branch/ref for `--changed`, e.g. `origin/main` (implies `--changed`). |
| `--variant <key=value>` | Record what distinguishes this run from a sibling run — e.g. `platform=linux` for one leg of a matrix. Recorded in `run.yaml` and used by [`testfile-viewer merge`](#testfile-viewer-merge-run). *(repeatable)* |
| `-l, --label <key=value>` | Record a label with the run, e.g. `branch=main`, so it can be [found again later](./cli#labelling-runs). Split at the first `=`; a key may only be given once. *(repeatable)* |
| `--shard <i/n>` | Run only this shard of the selected tests, e.g. `2/4`. Time-balanced from the [run history](./cli#run-history) when it has durations, round-robin otherwise. |

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
while writing). Exits `1` when the file is rejected.

| Option | Description |
| ------ | ----------- |
| `--json [file]` | Write the result as JSON (`{path, valid}`, plus `message` and one `errors` entry per schema violation when invalid), to a file or (without a value) stdout. |

### `testfile init [path]`

Create a starter Testfile in the given directory, derived from what the
project already has: `package.json` scripts plus
[imported](./getting-started#1-create-a-testfile) docker-compose services,
GitHub workflow steps and Make/Task/just targets.

| Option | Description |
| ------ | ----------- |
| `--from <file>` | Import this file instead of the auto-detected ones: a docker-compose file, a GitHub workflow, a `Makefile`, a `Taskfile` or a `justfile`. Repeatable. |
| `--no-detect` | Do not look for importable files automatically. |

### `testfile doctor [path]`

Check this machine against what the Testfile needs, before a run finds out
the hard way: Node.js version, git (and whether the folder is inside a work
tree), every `shell:` the tests invoke, every executable a `command:` starts
(on `PATH`, or as a relative/absolute path), the container engines when the
file starts containers — podman, docker and kubernetes are all checked, and
the report says which one [a run would pick](./services#containers) — the
fixed `ports:` and a writable `.testfile/`. Exits `1` when a check fails;
warnings (a missing git, for instance) do not.

| Option | Description |
| ------ | ----------- |
| `--json [file]` | Write the checks as JSON (`{status, checks: [{name, status, detail, hint}]}`), to a file or (without a value) stdout. |

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
Sharing lives under its own commands: [`archive`](#testfile-viewer-archive-subcommands),
[`s3`](#testfile-viewer-s3-subcommands) and
[`github`](#testfile-viewer-github-subcommands).

| Option | Description |
| ------ | ----------- |
| `--json [file]` | Write the full run records as JSON, to a file or (without a value) stdout. Combines with `--flaky` for a JSON flakiness report. |
| `--flaky` | Instead of the table: find tests that [fail too often to trust](./cli#run-history) across recorded runs. |
| `--last <n>` | With `--flaky`: only consider the most recent `n` runs. |
| `--filter-status <status>` | Only runs with this status: `passed`, `failed` or `aborted`. *(repeatable)* |
| `--filter-label <key=value>` | Only runs carrying this [label](./cli#labelling-runs); a bare `key` asks whether it is set at all. *(repeatable)* |
| `--filter-variant <key=value>` | Only runs with this variant, including the legs of a [merged run](#testfile-viewer-merge-run). *(repeatable)* |

Several values of one filter are an **OR**, different filters an **AND**,
and an unused filter narrows nothing. The filters apply to everything the
command produces — the table, `--json` and the `--flaky` report all see
the same runs.

### `testfile-viewer inspect run <id> [path]`

Show one recorded run in detail — a unique id prefix is enough.

| Option | Description |
| ------ | ----------- |
| `--log [test-path]` | Print the run's merged log, or a single test's log. |
| `--json [file]` | Write the full run record as JSON, to a file or (without a value) stdout. Cannot be combined with `--log`, which is raw text. |

### `testfile-viewer diff <older> <newer> [path]`

Compare two recorded runs (older id first, unique prefixes are enough):
newly failed, fixed, still failing, added/removed tests and significant
duration changes.

| Option | Description |
| ------ | ----------- |
| `--json [file]` | Write the diff as JSON (`{base, compare, newlyFailed, fixed, stillFailing, added, removed, durations}`), to a file or (without a value) stdout. |

### `testfile-viewer merge <run...>`

Combine several runs into a single run — [shards](./cli#sharding-across-machines) or one
job per platform — and write it into a history. Each `<run>` is either a
run folder (an unpacked CI artifact: `run.yaml` next to the logs) or an id
(or unique prefix) in the target history.

| Option | Description |
| ------ | ----------- |
| `--dir <path>` | History the merged run is written to (default `.`). |
| `--id-suffix <suffix>` | Last part of the merged run's id (default `merged`). |

The merged run is an ordinary run: one status, one duration, the union of
the tests. Runs that recorded the same test path must carry distinct
[`--variant`](#testfile--the-runner) values — see the
[guided tour](./three-platforms). Exits non-zero when the merged verdict
is not `passed`.

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

### `testfile-viewer archive` subcommands

Pack recorded runs as local archives and [import](./cli#sharing-runs) them.

#### `archive pack [path]`

Pack a recorded run as a `.tgz` archive.

| Option | Description |
| ------ | ----------- |
| `--run <id>` | Run to pack, id prefix is enough (default: the latest run). |
| `-o, --output <file>` | Target file (default: `testfile-run-<id>.tgz`). |

#### `archive import <archive> [path]`

Import a packed run into the local history. `archive` is a `.tgz` (from
`archive pack`) or a `.zip` (a downloaded GitHub run artifact). Already
imported run ids are skipped. No options.

### `testfile-viewer s3` subcommands

Share runs via an S3 bucket (`s3://bucket/prefix`, uses the `aws` CLI).

#### `s3 push <s3-prefix> [path]`

Pack a recorded run and upload it to S3.

| Option | Description |
| ------ | ----------- |
| `--run <id>` | Run to push, id prefix is enough (default: the latest run). |

#### `s3 pull <s3-prefix> [path]`

Download a run archive from S3 into the local history.

| Option | Description |
| ------ | ----------- |
| `--run <id>` | Exact run id to pull (default: the newest archive). |

#### `s3 list <s3-prefix>`

List the run archives available under the prefix, newest first.

| Option | Description |
| ------ | ----------- |
| `--json [file]` | Write the archive names as JSON (`{prefix, archives}`), to a file or (without a value) stdout. |

### `testfile-viewer github` subcommands

Bring the run artifacts of GitHub Actions workflow runs into the local
history. Both subcommands need `GITHUB_TOKEN` or `GH_TOKEN` (with
`actions:read`) — with the [gh CLI](https://cli.github.com/) logged in,
`export GITHUB_TOKEN=$(gh auth token)` sets one up. They take the same
options:

| Option | Description |
| ------ | ----------- |
| `--latest <n>` | Number of recent workflow runs to consider (default: `100`; more than 100 is fetched page by page). |
| `--artifact <name>` | Artifact name the action uploads (default: `testfile-run`), matched as a **prefix** — a matrix job that uploads `testfile-run-ubuntu-latest` and a merge job uploading `testfile-run-merged` are both picked up. |
| `--exact` | Require the artifact name to match exactly instead of as a prefix. |

#### `github sync <owner/repo> [path]`

Download the run artifacts of recent workflow runs and import them
(already imported run ids are skipped).

#### `github list <owner/repo>`

List the run artifacts available in recent workflow runs — workflow run
id, artifact name, workflow name, creation time and size — without
downloading anything.

| Option | Description |
| ------ | ----------- |
| `--json [file]` | Write the artifacts as JSON (`{repo, artifacts}`), to a file or (without a value) stdout. |

### `testfile-viewer gitlab` subcommands

Bring the run artifacts of GitLab CI jobs into the local history (see
[other CI systems](./ci-systems)). Both subcommands need `GITLAB_TOKEN`
(or `CI_JOB_TOKEN` inside a pipeline) and take the same options:

| Option | Description |
| ------ | ----------- |
| `--latest <n>` | Number of recent pipelines to consider (default: `5`). |
| `--job <name>` | Job whose artifacts hold the run (default: `testfile`). |
| `--ref <ref>` | Only pipelines for this branch or tag. |
| `--host <url>` | Self-hosted instance (default: `https://gitlab.com`). |

#### `gitlab sync <project> [path]`

Download the run artifacts of recent pipelines and import them. `project`
is a path like `group/project` or a numeric id.

#### `gitlab list <project>`

List the run artifacts available in recent pipelines — pipeline, job, name
and creation time — without downloading anything.

| Option | Description |
| ------ | ----------- |
| `--json [file]` | Write the artifacts as JSON (`{project, artifacts}`), to a file or (without a value) stdout. |
