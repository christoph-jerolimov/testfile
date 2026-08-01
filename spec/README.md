# Testfile specification (v1)

This document is the normative specification of the Testfile format. The
machine-readable counterpart is the JSON schema in
[`../schema/testfile.schema.json`](../schema/testfile.schema.json); if the two
disagree, this document wins and the schema has a bug.

## File

A Testfile is a YAML document. The runner looks for these file names in the
current directory, in this order:

1. `Testfile`
2. `testfile.yaml`
3. `testfile.yml`

## Concepts

A Testfile describes a **tree of tests**. The root of the document contains
exactly one test. Each test either

- runs a single shell **command**, or
- runs a multi-line shell **script**, or
- groups child tests that run in **sequence** or in **parallel**.

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
| `version`  | `1`    | yes      | Format version. Always `1` today. |
| `name`     | string | no       | Display name of the project/Testfile. |
| `env`      | map    | no       | Environment variables for everything in this file. |
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

Common fields available on every test:

| Field             | Type     | Description |
| ----------------- | -------- | ----------- |
| `name`            | string   | Display name. Matrix instances get their combination appended, e.g. `integration (postgres=16)`. |
| `description`     | string   | Free-form description. |
| `tags`            | array    | Optional labels made of letters and digits only (`[A-Za-z0-9]+`), e.g. `fast`, `slow`, `flaky`, `nightly`, `aws`, `gcp`. A tag applies to the test and its whole subtree. Runners use tags to execute a subset of tests. |
| `env`             | map      | Environment variables, merged over the parent's environment (child wins). |
| `workdir`         | string   | Working directory for this subtree, relative to the Testfile (or absolute). |
| `timeout`         | duration | Abort and fail this test (and its children) after this time. |
| `continueOnError` | boolean  | The failure of this test is reported but does not fail the parent group. Default `false`. |
| `services`        | map      | Services scoped to this subtree, see [Services](#services). |
| `matrix`          | map      | Matrix expansion, see [Matrix](#matrix). |
| `maxParallel`     | integer  | Only together with `parallel`: cap on concurrently running children. Default: unlimited. |

### Execution semantics

- A `sequence` runs children in order. When a child fails and does not have
  `continueOnError: true`, the remaining children are **skipped** and the
  sequence fails.
- A `parallel` group starts all children (bounded by `maxParallel`) and waits
  for all of them. It fails if any child failed (ignoring children with
  `continueOnError`). A failing child does **not** cancel its siblings.
- `command` runs via the system shell (`sh -c`); `script` is executed with
  `sh -e`, so the first failing line fails the script.
- The exit status of a test is one of `passed`, `failed`, `skipped` or
  `aborted` (run cancelled, e.g. Ctrl+C or timeout).

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

If a service exits by itself while dependent tests are still running, the
runner marks the service as failed and aborts the dependent subtree.

### Containers

| Field     | Type            | Description |
| --------- | --------------- | ----------- |
| `image`   | string (req.)   | Image reference, e.g. `docker.io/library/postgres:16`. |
| `engine`  | enum            | `auto` (default: podman if available, else docker), `podman`, `docker`. `kubernetes` is reserved for a future version (run in-cluster or on a remote cluster). |
| `ports`   | array of string | `"HOST:CONTAINER"` mappings; the host part may be a template like `"${{ ports.db }}:5432"`. |
| `env`     | map             | Environment inside the container. |
| `volumes` | array of string | `"HOST:CONTAINER[:OPTIONS]"` mounts. |
| `command` | array of string | Override the image command. |

### Readiness (`ready`)

At least one of the checks must be set; all set checks must pass. Checks are
polled every `interval` (default `1s`), starting after `delay`, until they
pass or `timeout` (default `30s`) expires — an expired timeout fails the
service and aborts the dependent tests.

| Field  | Type             | Description |
| ------ | ---------------- | ----------- |
| `http` | string or object | Ready when the URL answers. String form: URL, any 2xx passes. Object form: `url` (required), `method` (default `GET`), `status` (default: any 2xx). |
| `tcp`  | value or object  | Ready when a TCP connect succeeds. Plain form: a port on localhost (number or template string). Object form: `host` (default `localhost`), `port`. |
| `log`  | string or object | Ready when the service output matches a regular expression. String form: pattern, matched on both streams. Object form: `pattern` (required), `stream` (`stdout`, `stderr`, `any`; default `any`). |
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

The environment of a test/service is built by merging, child over parent:

1. the runner's own environment (the user's shell environment),
2. the top level `env`,
3. `env` of each ancestor test down to the node,
4. the node's own `env`.

String values anywhere in the document may contain templates of the form
`${{ scope.name }}` with these scopes:

| Scope    | Example              | Meaning |
| -------- | -------------------- | ------- |
| `env`    | `${{ env.HOME }}`    | Value from the merged environment at that node. |
| `ports`  | `${{ ports.web }}`   | A resolved named port. |
| `matrix` | `${{ matrix.node }}` | A matrix variable of the closest expanded ancestor (or the node itself). |

Referencing an undefined name is an error at run start. `duration` values are
either plain integers (seconds) or strings like `500ms`, `30s`, `5m`, `1h`.

## Exit code

The runner exits with `0` when the root test passed, `1` when any test failed
or a service could not start, and `130` when the run was interrupted.
