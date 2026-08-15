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
   `<runner> start <dir> [args] --reporter json --output <file>`, with any
   `env` from `expected.yaml` added to the environment and any `args`
   string spliced in verbatim (e.g. `--variant` flags). The report file is
   always `conformance-result.json` inside the copied case directory, and
   a stale one is deleted before each invocation — a runner must resolve
   `--output` against its working directory.
3. The runner's **exit code**, the report's **run status** and the
   **per-test statuses** (matched by test path) are compared against
   `expected.yaml`. A test expectation may additionally pin `cached`
   (whether the result came from the runner's result cache) and
   `artifacts` (the number of collected artifact files).
4. When `expected.yaml` lists `requires` (tool names, e.g. `podman` or
   `kubectl`), the harness checks that each tool answers for its backend —
   `<tool> info` for the container engines, `kubectl cluster-info` for a
   reachable cluster; a tool that does not **skips** the case instead of
   failing it, so the suite stays runnable everywhere while CI (where the
   tools exist) enforces it. Cases that need a specific engine pin it for
   their runner invocation via `env: {TESTFILE_ENGINE: ...}`.
5. When `expected.yaml` contains a `reruns` list, the runner is invoked
   again in the **same working copy** for each entry — this pins
   cross-run semantics like result caching. An entry's optional `before`
   shell command mutates the copy first (e.g. touching an input file);
   each entry carries its own `exitCode`/`status`/`tests` expectations.

## The contract for runners

A conforming runner must support this command shape (or ship an adapter
that does):

```sh
<runner> start <path> --reporter json --output <file>
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

Against the reference runner (after `npm ci && npm run build -w @testfile/runner`):

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
| `spec` | The specification sections this case pins — see [coverage](#coverage) below. |
| `requires` | Tool names that must answer for their backend (see above); otherwise the case is skipped. |
| `args` | Extra command-line arguments spliced into the runner invocation. |
| `env` | Extra environment variables set for the runner invocation (e.g. `TESTFILE_ENGINE`). |
| `exitCode` | Required process exit code. |
| `status` | Required run status in the report (`passed`, `failed`, `aborted`). |
| `variants` | Key/value pairs that must appear as the report's `variants`. |
| `tests` | List of `{path, status}`; each must appear in the report with that status. An entry may additionally pin `cached` and `artifacts` (a file count). |
| `absentTests` | Paths that must **not** appear in the report (tests that must not have run). |
| `reruns` | Further invocations in the same working copy, each with its own `exitCode`/`status`/`tests` and an optional `before` shell command. |

## Coverage

Every change to the execution semantics in [`../spec/TESTFILE.md`](../spec/TESTFILE.md)
must add or adjust a case here — the suite is the machine-checkable half of
the specification. [`coverage.mjs`](coverage.mjs) makes that convention
mechanical instead of merely written down:

```sh
npm run coverage --workspace conformance
```

Each case names the sections it pins, by their heading in the specification
(backticks dropped):

```yaml
spec:
  - Services
  - Readiness (ready)
```

The check fails when a spec section has no case, when a case names a section
that does not exist (a renamed heading), when a case declares no section at
all, and when an exemption in `NOT_EXECUTABLE` names a section that is gone.
Sections that describe rather than prescribe — the glossary, the file naming
— are exempt there, each with its reason.

A case may also point at the result format with a `RESULTS.md#` prefix (e.g.
`RESULTS.md#run.yaml`). Those references are validated, but the result
format's own coverage is not enforced here: the JSON schema and the viewer's
tests check it.
