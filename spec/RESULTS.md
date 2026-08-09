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

A YAML document with these fields. A JSON schema of this format ships as
[`schema/testrun.schema.json`](../schema/testrun.schema.json); runners
write a `# yaml-language-server: $schema=...` modeline as the first line
of every record, so editors validate and complete it.

| Field        | Type    | Required | Description |
| ------------ | ------- | -------- | ----------- |
| `id`         | string  | yes      | The run id; equals the folder name. |
| `startedAt`  | string  | yes      | Start time, ISO 8601 with milliseconds, UTC. |
| `durationMs` | integer | yes      | Wall-clock duration of the whole run. |
| `status`     | string  | yes      | `passed`, `failed` or `aborted` (user interrupt). |
| `exitCode`   | integer | yes      | The runner's exit code for this run (`0`, `1`, `130`). |
| `machine`    | string  | no       | Who ran the suite: a CI actor name (`GITHUB_ACTOR`, `GITLAB_USER_LOGIN`, `BUILDKITE_BUILD_CREATOR`), a GitHub login from an authenticated `gh`, or the hostname. Free-form identifier; consumers must not parse it. |
| `variants`   | map     | no       | What distinguishes this run from a sibling run of the same suite, as string values — e.g. `{platform: linux}` for one leg of a matrix. Keys and values are free-form; consumers display them and compare them for equality. |
| `labels`     | map     | no       | What the run should be findable by, as string values — e.g. `{branch: main, pr: "42"}`. Keys and values are free-form; a key appears at most once. Consumers display them and compare them for equality. Values are **always strings**, including numeric-looking ones. |
| `merged`     | object  | no       | Present when this run was produced by merging others — see [merged runs](#merged-runs). |
| `cancelled`  | boolean | yes      | True when the run was interrupted. |
| `env`        | map     | yes      | The resolved top-level `env` of the Testfile (may be empty). Secret values are masked. |
| `ports`      | map     | yes      | The resolved named ports (may be empty). |
| `selected`   | array   | yes      | Test paths the user selected for this run (empty = the whole suite). |
| `tests`      | array   | yes      | One entry per executed test, in **document order** (a pre-order walk of the suite; groups precede their children). Use `startedAt`/`startedAfterMs` for the temporal order — parallel groups make the two differ. See below. |
| `services`   | array   | no       | One entry per started service — see below. |
| `suite`      | object  | no       | The Testfile's test tree, including tests this run did not execute — see [`suite`](#suite). |
| `junit`      | string  | no       | Relative path of the JUnit XML (`junit.xml`). |

Consumers must ignore unknown fields (producers may add fields in later
format versions) and must skip run folders whose `run.yaml` is missing or
unreadable.

### `tests[]`

| Field        | Type    | Required | Description |
| ------------ | ------- | -------- | ----------- |
| `path`       | string  | yes      | The test's path: names joined with `/` from the root, e.g. `ci/checks/schema`. Group nodes appear next to their leaves; a test is a group iff another test's path nests below it. |
| `status`     | string  | yes      | `passed`, `failed`, `skipped` or `aborted`. |
| `startedAt`  | string  | no       | Start time, ISO 8601 with milliseconds, UTC; absent for tests that never started. |
| `startedAfterMs` | integer | no   | Milliseconds between the run's `startedAt` and this test's — how far into the run it began. Never negative. Absent exactly when `startedAt` is. |
| `durationMs` | integer | no       | Wall-clock duration; absent for tests that never started. |
| `log`        | string  | no       | Relative path of the test's merged stdout+stderr log; absent when the test produced no output. |
| `artifacts`  | array   | no       | Relative paths of collected artifact files. |
| `cached`     | boolean | no       | True when the result was served from the runner's result cache. |
| `variants`   | map     | no       | Merged runs only: the `variants` of the run this result came from. |
| `origin`     | string  | no       | Merged runs only: the `id` of the run this result came from. |
| `reason`     | string  | no       | Human-readable explanation of why a test with `inputs` ran or was reused — cache hit/miss detail (which pattern saw how many changed files) and/or the change-based selection that picked it. Free-form; consumers must not parse it. |

Every path in a record — `log`, `artifacts`, service logs — is relative to
the run folder and **`/`-separated on every platform**, including Windows.
A run travels (as an archive, a CI artifact, an S3 object) and is read by
viewers on other machines, so a producer must not write the local
separator.

### `suite`

The shape of the Testfile the run came from, so a `run.yaml` explains
itself without the Testfile next to it: the tree, what kind each node is,
which tags it carries and which matrix combination an expanded instance
belongs to. It describes the **whole** file, including tests that filters
excluded from this run — `tests[]` says what actually executed.

`suite` is a single root node; every node has these fields:

| Field      | Type   | Required | Description |
| ---------- | ------ | -------- | ----------- |
| `name`     | string | yes      | The test's own name. |
| `path`     | string | yes      | Names joined with `/` from the root — the key `tests[].path` uses. |
| `kind`     | string | yes      | `command`, `script`, `sequence`, `parallel` or `matrix` (the wrapper a matrix expands from). |
| `tags`     | array  | no       | Tags declared on this test. Tags of ancestors apply to it as well; the tree makes that inheritance visible. |
| `matrix`   | map    | no       | The combination of an expanded matrix instance, e.g. `{node: "22"}`. |
| `services` | array  | no       | Names of the services this test declares. |
| `children` | array  | no       | Nested nodes, in document order; absent on leaves. |

Producers **should** record `suite`; consumers must tolerate its absence
(records written by earlier runners have none) and fall back to deriving
nesting from the `path` values.

### `services[]`

| Field      | Type   | Required | Description |
| ---------- | ------ | -------- | ----------- |
| `name`     | string | yes      | The service name from the Testfile. |
| `status`   | string | no       | Last observed status, e.g. `ready`, `stopped`, `failed`. |
| `log`      | string | no       | Relative path of the service's log; absent without output. |
| `variants` | map    | no       | Merged runs only: the `variants` of the run this service ran in. |
| `origin`   | string | no       | Merged runs only: the `id` of that run. |

## Merged runs

Two things produce several run folders for what is conceptually one test
run: **sharding** (each shard runs a disjoint part of the suite) and a
**matrix of jobs** (every job runs the same suite somewhere else). A merged
run combines them into a single record — one verdict, one duration, the
union of the tests — so consumers show it like any other run.

A merged run **is an ordinary run**: `id`, `startedAt`, `status` and the
rest mean what they always mean, and a consumer that ignores `merged`
still reads it correctly. What merging adds is recorded rather than
hidden:

| Field              | Type   | Required | Description |
| ------------------ | ------ | -------- | ----------- |
| `merged.runs`      | array  | yes      | The merged runs, in the order they were combined. |
| `merged.runs[].id` | string | yes      | The merged run's id. |
| `merged.runs[].variants` | map | no    | That run's `variants`. |
| `merged.runs[].machine`  | string | no | That run's `machine`. |
| `merged.runs[].status`   | string | yes | That run's own verdict. |
| `merged.runs[].startedAt`| string | yes | That run's start time. |
| `merged.runs[].durationMs` | integer | yes | That run's duration. |
| `merged.variants`  | map    | no       | Every variant value the merged runs used, per key, e.g. `{platform: [linux, macos]}` — what a viewer shows as the run's header. |

How the top-level fields are derived:

| Field | Merged value |
| ----- | ------------ |
| `startedAt` | the earliest of the merged runs |
| `durationMs` | the **sum** of the merged runs' durations (time spent, not wall-clock span — the runs usually overlap) |
| `status` | `failed` if any merged run or test failed, else `aborted` if any was aborted, else `passed` |
| `exitCode` | `0` when passed, `130` when aborted after a cancellation, else `1` |
| `cancelled` | true when any merged run was cancelled |
| `variants` | the entries **all** merged runs agree on (a matrix over platforms that all used `node=22` keeps `node: "22"` here) |
| `env`, `ports` | the entries all merged runs agree on |
| `selected` | the union, in the order first seen |
| `labels` | the union; where two runs disagree on a key, the first run's value wins (what differs between the legs belongs in `variants`) |
| `suite` | the tree of the first merged run that recorded one |
| `tests`, `services` | the concatenation, each entry tagged with its `variants` and `origin` |
| `tests[].startedAfterMs` | recomputed against the merged `startedAt`, so one timeline holds every leg; `startedAt` is untouched. A test whose record has no `startedAt` keeps no offset either. |

**A test path may only appear once per variant combination.** Shards merge
without variants because no leaf appears twice; a matrix of jobs runs the
same test everywhere, so those runs must carry distinct `variants` — that
is what keeps `path` + `variants` unique and the merged run readable. A
producer that finds a duplicate must fail rather than silently drop or
overwrite a result.

**Group nodes are the exception.** A group is scaffolding around the tests
below it, and every shard records the groups its own leaves sit in, so the
same group path legitimately appears in several runs. Merging folds those
into one entry per `path` + `variants`: the worst status of the
contributions and the sum of their durations, with no single `origin`.

Copied logs and artifacts are namespaced by the run they came from —
`tests/<origin-id>/<slug>.log` — so the same test's logs from different
legs stay apart. As everywhere else, the authoritative paths are the ones
recorded in `run.yaml`.

In this repository `testfile-viewer merge <run…>` writes such a run; it
takes run folders (an unpacked CI artifact) or ids from a local history.

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

Every run folder a **runner** records contains the run as JUnit XML: one
`<testcase>` per **leaf** test (`name` = last path segment, `classname` =
parent path), `<failure>` elements carrying the test's log, `<skipped/>`
markers, and counts/timestamps on the suite elements. Merged runs (see
above) carry no `junit.xml` and no `junit` field — which is why the field
is optional.

## Secrets

Values loaded from `envFile` files, and the variables a Testfile names in
`secrets:` (see the [format specification](README.md)), are secrets:
producers must mask them (`***`) in every recorded log and must not write
them into `run.yaml`. (Values shorter than 4 characters are exempt — masking
them would mark ubiquitous substrings as secret without hiding anything.)

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
