# Test result format (v0)

> **Status: under review**, together with the [Testfile format](README.md).
> Feedback is welcome via
> [GitHub issues](https://github.com/christoph-jerolimov/testfile/issues).

The Testfile specification has two parts:

1. the **Testfile format** ([README.md](README.md)) — the *input*: how a
   project describes its tests, and
2. this document — the *output*: how a recorded test run looks on disk.

The two parts are deliberately independent: **different tools can generate
results and different tools can consume them**. A runner (any
implementation) produces the layout below; viewers — a history CLI, a TUI,
a web UI, CI tooling — only ever read it. A result consumer must not
assume which runner produced a run.

## Layout

Runs are recorded next to the Testfile in a `.testfile/` folder. Every run
is one **self-contained folder**:

```
.testfile/
  .gitignore             # "*" - the folder ignores itself
  runs/
    <run-id>/
      run.yaml           # the run's record (this document's core)
      junit.xml          # the same result as JUnit XML, for CI tooling
      tests/<slug>.log   # merged stdout+stderr per test
      services/<slug>.log# log of each started service
      artifacts/<slug>/… # files collected via the tests' `artifacts` globs
```

Log and artifact file names are derived from the test path (lower-cased,
non-alphanumerics collapsed to `-`, plus a short hash against collisions),
but consumers must not parse them: the authoritative names are the
**relative paths recorded in `run.yaml`** (`log`, `artifacts`, `junit`).

### Run ids and ordering

A run id starts with the run's UTC timestamp at second resolution plus a
random suffix, e.g. `20260802-193731-4bdc`. Ids are unique per history but
only sort chronologically at second granularity — consumers **order runs
by the record's `startedAt`** (millisecond ISO 8601 timestamp), using the
id as tie-breaker.

## run.yaml

A YAML document with these fields:

| Field        | Type    | Required | Description |
| ------------ | ------- | -------- | ----------- |
| `id`         | string  | yes      | The run id; equals the folder name. |
| `startedAt`  | string  | yes      | Start time, ISO 8601 with milliseconds, UTC. |
| `durationMs` | integer | yes      | Wall-clock duration of the whole run. |
| `status`     | string  | yes      | `passed`, `failed` or `aborted` (user interrupt). |
| `exitCode`   | integer | yes      | The runner's exit code for this run (`0`, `1`, `130`). |
| `cancelled`  | boolean | yes      | True when the run was interrupted. |
| `env`        | map     | yes      | The resolved top-level `env` of the Testfile (may be empty). Secret values are masked. |
| `ports`      | map     | yes      | The resolved named ports (may be empty). |
| `selected`   | array   | yes      | Test paths the user selected for this run (empty = the whole suite). |
| `tests`      | array   | yes      | One entry per executed test, in execution order — see below. |
| `services`   | array   | no       | One entry per started service — see below. |
| `junit`      | string  | no       | Relative path of the JUnit XML (`junit.xml`). |

Consumers must ignore unknown fields (producers may add fields in later
format versions) and must skip run folders whose `run.yaml` is missing or
unreadable.

### `tests[]`

| Field        | Type    | Required | Description |
| ------------ | ------- | -------- | ----------- |
| `path`       | string  | yes      | The test's path: names joined with `/` from the root, e.g. `ci/checks/schema`. Group nodes appear next to their leaves; a test is a group iff another test's path nests below it. |
| `status`     | string  | yes      | `passed`, `failed`, `skipped` or `aborted`. |
| `durationMs` | integer | no       | Wall-clock duration; absent for tests that never started. |
| `log`        | string  | no       | Relative path of the test's merged stdout+stderr log; absent when the test produced no output. |
| `artifacts`  | array   | no       | Relative paths of collected artifact files. |
| `cached`     | boolean | no       | True when the result was served from the runner's result cache. |

### `services[]`

| Field    | Type   | Required | Description |
| -------- | ------ | -------- | ----------- |
| `name`   | string | yes      | The service name from the Testfile. |
| `status` | string | no       | Last observed status, e.g. `ready`, `stopped`, `failed`. |
| `log`    | string | no       | Relative path of the service's log; absent without output. |

## Log files

Logs are plain UTF-8 text with `\n` line endings. Lines produced by the
runner itself (not the test's process) are prefixed with `# ` — e.g.
retry notices, timeout messages, `cached:` markers. Everything else is the
test's stdout and stderr, merged in arrival order.

There is no persisted whole-run log: viewers assemble the merged view on
demand by concatenating, in record order, a `=== <path> (<status>[, <duration>ms]) ===`
header per test followed by its log, then
`=== service <name> (<status>) ===` sections. (Runs recorded by early
runners may contain a pre-merged `output.log`; consumers should serve it
as-is when present.)

## junit.xml

Every run folder contains the run as JUnit XML: one `<testcase>` per
**leaf** test (`name` = last path segment, `classname` = parent path),
`<failure>` elements carrying the test's log, `<skipped/>` markers, and
counts/timestamps on the suite elements.

## Secrets

Values loaded from `envFile` files are secrets: producers must mask them
(`***`) in every recorded log and must not write them into `run.yaml`.

## Retention and concurrency

Producers may prune old runs (the reference runner keeps the most recent
50 folders). A run folder is written completely before it is discoverable
by its `run.yaml`; consumers watching `.testfile/runs/` should tolerate
folders appearing and disappearing at any time.

## Legacy

Very early runners wrote a single `runs.yaml` index next to `runs/`
instead of per-run records. Consumers may read it (entries have the same
shape as `run.yaml`), but must not require it; producers must not write
it.
