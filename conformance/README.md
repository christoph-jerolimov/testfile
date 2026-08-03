# Testfile conformance suite

This suite defines the **observable execution semantics** of the Testfile
format, independently of any particular runner. A runner implementation — the
TypeScript reference runner in this repository, or a future `runner-go`,
`runner-rust`, ... — proves compatibility by passing every case.

## How it works

Each case in [`cases/`](cases/) is a directory containing:

- a `Testfile` (plus any auxiliary files the case needs), and
- an `expected.yaml` describing the outcome a conforming runner must produce.

The harness (`run.mjs`) runs every case against the runner under test:

1. The case directory is **copied to a fresh temporary directory**, so cases
   are hermetic and may write files.
2. The runner is invoked as
   `<runner> run <dir> --reporter json --output <file>`, with any `env`
   from `expected.yaml` added to the environment.
3. The runner's **exit code**, the report's **run status** and the
   **per-test statuses** (matched by test path) are compared against
   `expected.yaml`. A test expectation may additionally pin `cached`
   (whether the result came from the runner's result cache) and
   `artifacts` (the number of collected artifact files).
4. When `expected.yaml` lists `requires` (tool names, e.g. `podman`),
   the harness checks each with `command -v <tool> && <tool> info`; a
   missing tool **skips** the case instead of failing it, so the suite
   stays runnable everywhere while CI (where the tools exist) enforces
   it.
5. When `expected.yaml` contains a `reruns` list, the runner is invoked
   again in the **same working copy** for each entry — this pins
   cross-run semantics like result caching. An entry's optional `before`
   shell command mutates the copy first (e.g. touching an input file);
   each entry carries its own `exitCode`/`status`/`tests` expectations.

## The contract for runners

A conforming runner must support this command shape (or ship an adapter
that does):

```sh
<runner> run <path> --reporter json --output <file>
```

and write a JSON report containing at least:

```json
{
  "status": "passed | failed | aborted",
  "exitCode": 0,
  "tests": [
    { "path": "root/child", "status": "passed | failed | skipped | aborted",
      "cached": false, "artifacts": ["..."] }
  ]
}
```

Test paths are the test names joined with `/` from the root (matrix
instances get their combination appended, e.g. `m (db=postgres)`).

## Running

Against the reference runner (after `npm ci && npm run build -w runner-ts`):

```sh
npm test --workspace conformance
```

Against another runner:

```sh
TESTFILE_RUNNER="testfile-go" node conformance/run.mjs
```

An optional argument filters cases by substring:
`node conformance/run.mjs matrix`.

## expected.yaml

| Field | Meaning |
| ----- | ------- |
| `exitCode` | Required process exit code. |
| `status` | Required run status in the report (`passed`, `failed`, `aborted`). |
| `env` | Extra environment variables set for the runner invocation. |
| `tests` | List of `{path, status}`; each must appear in the report with that status. |
| `absentTests` | Paths that must **not** appear in the report (tests that must not have run). |

## Adding cases

Every change to the execution semantics in [`../spec/README.md`](../spec/README.md)
must add or adjust a case here — the suite is the machine-checkable half of
the specification.
