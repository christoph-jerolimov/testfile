# Testfile specification (v0)

> **Status: under review.** This specification describes format version 0,
> a draft that may still change based on feedback. Version 1 — the first
> version with stability guarantees — is targeted for Q4 2026. Feedback on
> any part of the format is welcome via
> [GitHub issues](https://github.com/christoph-jerolimov/testfile/issues).

This document is the normative specification of the Testfile format — the
*input* side: how a project describes its tests. The *output* side — how a
recorded test run looks on disk (`.testfile/runs/<id>/` with `run.yaml`,
logs and `junit.xml`) — is specified in [RESULTS.md](RESULTS.md), so that
different tools can generate results and different tools can consume
them. The machine-readable counterpart of this document is the JSON schema
in [`../schema/testfile.schema.json`](../schema/testfile.schema.json); if
the two disagree, this document wins and the schema has a bug.

The execution semantics described here are additionally pinned by the
runner-independent [conformance suite](../conformance/README.md): every
change to this document must add or adjust a conformance case, and a runner
implementation claims compatibility by passing the whole suite.

## File

A Testfile is a YAML document. The runner looks for these file names in the
current directory, in this order:

1. `Testfile`
2. `testfile.yaml`
3. `testfile.yml`

## Concepts

A Testfile describes a **test suite**. The root of the document contains
exactly one test. Each test either

- runs a single shell **command**, or
- runs a multi-line shell **script**, or
- groups **nested tests** that run in **sequence** or in **parallel**.

Groups nest arbitrarily deep. Throughout this document, a test's *nested
tests* are all tests contained below it, directly or transitively.

Any test can additionally be expanded by a **matrix** into one instance per
variable combination.

Tests may depend on **services** — long-running processes the tests need,
such as the web server or app under test, or databases in specific versions.
Services run as local processes or as containers (podman/docker today;
kubernetes is a reserved engine name for a future version). The runner starts
them before the dependent tests, waits until they are **ready** (HTTP check,
TCP check, or a log pattern on stdout/stderr), and **gracefully stops** them
afterwards — including when the user aborts the run with Ctrl+C.

## Top level document

| Field      | Type   | Required | Description |
| ---------- | ------ | -------- | ----------- |
| `version`  | `0`    | yes      | Format version. Always `0` while the format is under review; see the [versioning policy](VERSIONING.md). |
| `name`     | string | no       | Display name of the project/Testfile. |
| `env`      | map    | no       | Environment variables for everything in this file. |
| `envFile`  | string/array | no | Dotenv file(s), relative to the Testfile, loaded for the whole run. See [Env files](#env-files). |
| `ports`    | map    | no       | Named ports, see [Ports](#ports). |
| `services` | map    | no       | Services for the whole run, see [Services](#services). |
| `test`     | test   | yes      | The root test. |

Unknown fields are an error everywhere in the document — this catches typos.

## Tests

A test is an object with **exactly one** of the following variant fields:

| Field      | Type          | Description |
| ---------- | ------------- | ----------- |
| `command`  | string        | A single shell command. The test passes iff it exits with code 0. |
| `script`   | string        | A multi-line shell script, executed with `sh -e`. The test passes iff it exits with code 0. |
| `sequence` | array of test | Children run one after another. The first failure stops the sequence and fails it, unless the failing child sets `continueOnError`. |
| `parallel` | array of test | Children run concurrently. The group fails if any child fails. |
| `include`  | string        | Path or glob (relative to this Testfile, not templated) of another Testfile — or a directory containing one — embedded here, see [Includes](#includes). |

Common fields available on every test:

| Field             | Type     | Description |
| ----------------- | -------- | ----------- |
| `name`            | string   | Display name. Matrix instances get their combination appended, e.g. `integration (postgres=16)`. |
| `description`     | string   | Free-form description. |
| `tags`            | array    | Optional labels made of letters and digits only (`[A-Za-z0-9]+`), e.g. `fast`, `slow`, `flaky`, `nightly`, `aws`, `gcp`. A tag applies to the test and all its nested tests. Runners use tags to execute a subset of tests. |
| `if`              | string   | Condition deciding whether the test (and its nested tests) runs, see [Conditions](#conditions). A false condition marks the test `skipped` without failing the parent. |
| `env`             | map      | Environment variables, merged over the parent's environment (child wins). |
| `envFile`         | string/array | Dotenv file(s), relative to the test's working directory, loaded for this test and its nested tests. See [Env files](#env-files). |
| `workdir`         | string   | Working directory for this test and its nested tests, relative to the Testfile (or absolute). |
| `timeout`         | duration | Abort and fail this test (and its children) after this time. |
| `continueOnError` | boolean  | The failure of this test is reported but does not fail the parent group. Default `false`. |
| `retry`           | int/object | Only on `command`/`script` tests: retry on failure. An integer is the number of additional attempts; the object form `{count, delay}` adds a wait between attempts. The test fails when the last attempt fails. |
| `shell`           | string   | Only on `command`/`script` tests: interpreter instead of `sh`, e.g. `bash`, `bash -e`, `python3`. Split on whitespace and invoked as `<shell...> -c <source>`, so the interpreter must accept `-c`. The default `sh -e` for scripts does not apply — pass flags like `-e` yourself. |
| `services`        | map      | Services scoped to this test and its nested tests, see [Services](#services). |
| `matrix`          | map      | Matrix expansion, see [Matrix](#matrix). |
| `maxParallel`     | integer  | Only together with `parallel`: cap on concurrently running children. Default: unlimited. |
| `needs`           | array    | Only on children of a `parallel` group: names of sibling tests that must finish first, turning the group into a DAG. The test starts once all named siblings passed or were skipped; if one failed, the test is skipped. References must name existing, unambiguous siblings and must not form cycles. |
| `artifacts`       | array    | Glob patterns, relative to the test's working directory, of files the test produces (coverage, screenshots, reports). Runners copy matching files into the recorded run — also when the test failed. |
| `inputs`          | array    | Only on `command`/`script` tests: glob patterns, relative to the test's working directory, of the files the test depends on. Enables [result caching](#result-caching). |
| `setup`           | hook     | Runs after the test's services are ready and before its body. A failing setup skips the body and fails the test; teardown still runs. See [Hooks](#hooks). |
| `teardown`        | hook     | Always runs after the test's body — on success, failure and abort — before the test's services stop. A failing teardown fails an otherwise passing test. See [Hooks](#hooks). |

### Execution semantics

- A `sequence` runs children in order. When a child fails and does not have
  `continueOnError: true`, the remaining children are **skipped** and the
  sequence fails.
- A `parallel` group starts all children (bounded by `maxParallel`) and waits
  for all of them. It fails if any child failed (ignoring children with
  `continueOnError`). A failing child does **not** cancel its siblings.
- Children of a `parallel` group may declare `needs` on sibling names; such a
  child waits for the named siblings and is skipped when one of them failed.
  `maxParallel` slots are only occupied by running tests, not by waiting
  ones. Siblings excluded by runner filters count as satisfied.
- `command` runs via the system shell (`sh -c`); `script` is executed with
  `sh -e`, so the first failing line fails the script.
- The exit status of a test is one of `passed`, `failed`, `skipped` or
  `aborted` (run cancelled, e.g. Ctrl+C or timeout).

## Conditions

`if` is evaluated after template resolution, with these rules:

- Unknown template references resolve to `""` instead of erroring (so
  `if: ${{ env.CI }}` works locally where `CI` is unset).
- A bare value is a truthiness check: `""`, `"false"`, `"0"`, `"no"` and
  `"off"` (case-insensitive) are false, everything else is true.
- `left == right` / `left != right` compare as strings; surrounding quotes
  are stripped from the operands.
- A leading `!` negates the whole expression (quote it in YAML:
  `if: "!${{ env.CI }}"`).

The runner injects `TESTFILE_OS` (`linux`, `darwin`, `win32`) and
`TESTFILE_ARCH` into the environment, so platform conditions are written as
`if: ${{ env.TESTFILE_OS }} == linux`.

A false condition skips the test and its nested tests (status `skipped`). This
does not fail the surrounding sequence/parallel group; a group whose active
children all skipped is itself `skipped`. A fully skipped run exits with
code `0`.

## Includes

`include` embeds another Testfile as a nested suite, composing e.g. per-package
Testfiles of a monorepo into one:

```yaml
test:
  sequence:
    - name: packages
      include: packages/*/Testfile
    - include: ./app
```

Rules:

- The path is resolved relative to the including file and may point to a
  Testfile or to a directory containing one. A glob embeds every match; two
  or more matches form a `parallel` group. Templates are not supported in
  the path. Nothing matching is an error.
- The included document must be a valid Testfile itself (including
  `version`). Includes nest; cycles are an error.
- The included file's directory becomes the working directory of the
  embedded tests (`workdir` cannot be set on an include test).
- The included file's top-level `env` and `services` are scoped to the
  embedded tests; `env` set on the include test wins over the included
  file's values.
- The included file's `ports` merge into the including document's `ports`.
  Two definitions of the same port name with different values are an error.
- Other fields on the include test (`name`, `tags`, `if`, `timeout`,
  `setup`/`teardown`, `matrix`, ...) apply to the embedded tests as usual.

## Hooks

`setup` and `teardown` are objects with **exactly one** of `command` or
`script` (run with `sh -c` / `sh -e`), plus optional `env`, `workdir` and
`timeout`. They run in the test's environment (their own `env` merged on
top) and write into the test's log.

Order of one test: services start and become ready → `setup` → body
(command/script/children) → `teardown` → services stop.

- A failing `setup` (non-zero exit or timeout) fails the test; the body is
  skipped, `teardown` still runs.
- `teardown` always runs once the test got as far as starting — including
  when the body failed or the run was interrupted with Ctrl+C — and cannot
  be aborted (a second Ctrl+C force-kills). A failing `teardown` fails an
  otherwise passing test; it never masks an earlier failure.
- On a test with a `matrix`, hooks run per instance.

## Matrix

`matrix` maps variable names to lists of scalar values. The test is expanded
into one instance per entry of the cross product:

```yaml
test:
  name: integration
  matrix:
    node: ["20", "22"]
    db: [postgres, mysql]
  command: npm run test:integration
```

expands into 4 instances. Two reserved keys refine the set:

- `exclude`: a list of partial combinations; every combination that matches
  all values of an exclude entry is removed.
- `include`: a list of combinations appended after the cross product and
  `exclude` were evaluated.

Matrix instances of one test run like a `parallel` group of the expanded
instances (bounded by `maxParallel` if set together with a group variant).
Matrix values are available to the instance as `${{ matrix.NAME }}` templates
and as environment variables named `TESTFILE_MATRIX_<NAME>` (upper-cased).

Matrix variables are also substituted inside the instance's `services`, so a
matrix over database versions can start one container per version:

```yaml
matrix:
  postgres: ["15", "16", "17"]
services:
  postgres:
    container:
      image: docker.io/library/postgres:${{ matrix.postgres }}
```

## Ports

`ports` declares named ports for the run:

```yaml
ports:
  web: random   # a free port, allocated when the run starts
  db: 5432      # a fixed port
```

`random` asks the runner to allocate a currently free TCP port. The resolved
number is available everywhere as `${{ ports.NAME }}`.

## Services

A service is an object with **exactly one** of:

| Field       | Type   | Description |
| ----------- | ------ | ----------- |
| `command`   | string | Run a local process with this shell command. |
| `script`    | string | Run a local process with this shell script (`sh -e`). |
| `container` | object | Run a container, see below. |

plus the common fields `description`, `env`, `workdir`, `ready` and `stop`.

Services declared at the top level start before the root test and stop after
the whole run. Services declared on a test start before that test (after the
parent's services) and stop when the test finishes. Services of one `services`
map are started concurrently; tests only start after **all** of their services
(including inherited ones) reported ready. Services are stopped in reverse
start order. Service names are also visible in the TUI so the user can switch
to their output.

A service with `shared: true` is started once per **resolved
configuration** (name plus command/script/container, env, workdir after
template resolution) and reference-counted: matrix instances or parallel
tests whose resolved config is identical reuse the running instance, which
stops after the last of them finished. Configs that differ — e.g. a matrix
variable in the image or env — still get their own instance. A shared
service sees the environment of the test that started it; if it dies
unexpectedly, all tests depending on it are aborted.

If a service exits by itself while dependent tests are still running, the
runner marks the service as failed and aborts the dependent tests.

### Containers

| Field     | Type            | Description |
| --------- | --------------- | ----------- |
| `image`   | string (req.)   | Image reference, e.g. `docker.io/library/postgres:16`. |
| `engine`  | enum            | `auto` (default: podman if available, else docker), `podman`, `docker`. `kubernetes` is reserved for a future version (run in-cluster or on a remote cluster). |
| `ports`   | array of string | `"HOST:CONTAINER"` mappings; the host part may be a template like `"${{ ports.db }}:5432"`. |
| `env`     | map             | Environment inside the container. |
| `volumes` | array of string | `"HOST:CONTAINER[:OPTIONS]"` mounts. |
| `pull`    | enum            | `always`, `missing` (default) or `never`: when to pull the image. |
| `network` | string          | Attach to this named container network, creating it if needed (networks are left in place after the run). The service name becomes a network alias, so services on the same network reach each other by name. |
| `entrypoint` | array of string | Override the image entrypoint. |
| `command` | array of string | Override the image command. |

### Readiness (`ready`)

At least one of the checks (`http`, `tcp`, `log`, `exec`) must be set; all
set checks must pass. Checks are
polled every `interval` (default `1s`), starting after `delay`, until they
pass or `timeout` (default `30s`) expires — an expired timeout fails the
service and aborts the dependent tests.

| Field  | Type             | Description |
| ------ | ---------------- | ----------- |
| `http` | string or object | Ready when the URL answers. String form: URL, any 2xx passes. Object form: `url` (required), `method` (default `GET`), `status` (default: any 2xx). |
| `tcp`  | value or object  | Ready when a TCP connect succeeds. Plain form: a port on localhost (number or template string). Object form: `host` (default `localhost`), `port`. |
| `log`  | string or object | Ready when the service output matches a regular expression. String form: pattern, matched on both streams. Object form: `pattern` (required), `stream` (`stdout`, `stderr`, `any`; default `any`). |
| `exec` | string or object | Ready when the shell command exits with code 0 (e.g. `pg_isready`, `redis-cli ping`). Runs in the service's environment and working directory; a single attempt is capped at 10s. |
| `delay`    | duration | Wait before the first check. |
| `interval` | duration | Poll interval. Default `1s`. |
| `timeout`  | duration | Overall deadline. Default `30s`. |

### Stopping (`stop`)

| Field     | Type     | Description |
| --------- | -------- | ----------- |
| `signal`  | string   | Signal sent to the process (group). Default `SIGTERM`. |
| `timeout` | duration | Grace period before escalating to `SIGKILL`. Default `10s`. Containers are stopped via the engine's `stop` with the same timeout. |
| `command` | string   | Run this shell command to stop the service instead of sending a signal. |

Graceful shutdown is guaranteed on normal completion, on failure, and when
the user interrupts the runner (first Ctrl+C: graceful stop of tests and
services; second Ctrl+C: force kill).

## Environment and templates

Tests and services run in an **isolated environment**: variables of the
host (the user's shell, the CI job) do not leak in. The base environment
consists of

- a small allowlist of essentials from the host: `PATH`, `HOME`, `USER`,
  `LOGNAME`, `SHELL`, `TMPDIR`/`TMP`/`TEMP`, `LANG`, `LC_*`, `TZ`, `XDG_RUNTIME_DIR` (plus
  their Windows equivalents), and
- values the runner provides: `CI=1`, `FORCE_COLOR=1` and
  `CLICOLOR_FORCE=1` (so tools emit color even though their output is a
  pipe), and `TESTFILE_OS`/`TESTFILE_ARCH`.

Further host variables must be **forwarded explicitly** with `forwardEnv`:
a list of variable names or patterns where `*` matches any run of
characters — `GITHUB_*`, `MY_TOKEN`, or just `*` for everything. It is
available at the top level (applies to the whole run) and on any test
(applies to its nested tests). Forwarded values override the runner-provided
defaults, so forwarding `CI` restores the host's value.

On top of that base, the environment of a test/service is built by
merging, child over parent:

1. the base environment described above (plus top-level forwarded vars),
2. the top level `env`,
3. `env` and forwarded variables of each ancestor test down to the test itself,
4. the test's own `env`.

String values anywhere in the document may contain templates of the form
`${{ scope.name }}` with these scopes:

| Scope    | Example              | Meaning |
| -------- | -------------------- | ------- |
| `env`    | `${{ env.HOME }}`    | Value from the merged environment at that test. |
| `ports`  | `${{ ports.web }}`   | A resolved named port. |
| `matrix` | `${{ matrix.node }}` | A matrix variable of the closest expanded ancestor (or the test itself). |

A template may carry a default after `||`, used when the reference is
undefined **or empty**: `${{ env.PORT || 3000 }}`. The default is plain text
(optionally single- or double-quoted, quotes are stripped) and may not
contain `}`. Referencing an undefined name **without** a default is an error
at run start. `duration` values are either plain integers (seconds) or
strings like `500ms`, `30s`, `5m`, `1h`.

## Env files

`envFile` loads dotenv-format files: `KEY=VALUE` lines, blank lines and
`#` comments, an optional `export ` prefix, single/double quoted values, and
`${{ ... }}` templates in values. Multiple files load in order; later files
win. A missing file is an error.

Precedence, lowest to highest: inherited environment < forwarded host
variables < env file(s) < explicit `env` of the same level. Top-level `envFile` paths resolve relative to the
Testfile; test-level paths resolve relative to the test's working directory.

Values loaded from env files are treated as **secrets**: runners must mask
them in recorded logs (and never write them into run records). Note that the
live terminal output is not masked.

## Result caching

A test that declares `inputs` states that its outcome depends only on the
matched files and its own configuration. Runners **may** then skip the test
and reuse its previous result, under these rules:

- Only **passing** results may be reused; a failure always re-runs.
- A result may only be reused when the content of every matched input file
  is unchanged **and** the test's configuration (resolved command/script,
  its own `env`, its matrix combination) is unchanged. Renaming, adding or
  removing matched files invalidates the cache.
- A cached test reports status `passed`, marked as cached in run records
  and logs; its services, hooks and retries do not run.
- Runners must offer a way to bypass reuse (the reference runner:
  `--no-cache`, which still refreshes stored results).

Cache storage is runner-specific (the reference runner uses
`.testfile/cache.json`) and **local to one machine**: reuse only happens
when the same suite runs again on the same working copy. Distributing or
restoring a cache across machines (e.g. onto CI runners) is outside this
spec; runners that support it must still apply the reuse rules above.
Caching is optional runner behavior: a runner that never caches — like one
executing the conformance suite — is fully conforming.

Runners may additionally use the `inputs` declarations for **change-based
test selection** — e.g. the reference runner's `--changed` runs only tests
whose inputs match a file that differs from a git base branch. That is a
selection feature, not result reuse: deselected tests are simply not part
of the run, and no cached result is reported for them. Runners that record
runs should state *why* an `inputs` test ran or was reused (the reference
runner's `reason` field, see the [result format](./RESULTS.md)).

## Exit code

The runner exits with `0` when the root test passed, `1` when any test failed
or a service could not start, and `130` when the run was interrupted.
