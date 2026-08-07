# @testfile/runner

The reference runner for the
[Testfile](https://github.com/christoph-jerolimov/testfile) format: a
`testfile` CLI that runs the test suite described in your `Testfile` /
`testfile.yaml` — starting the services tests depend on, waiting for their
readiness checks and stopping them gracefully — plus an interactive TUI.

```sh
testfile start              # run the suite, stream progress, record the run
testfile tui                # interactive terminal UI (tests, runs, results, services)
testfile start -w -f unit   # watch mode + filter: a tight edit-test loop
testfile validate           # check the file against the JSON schema
testfile init               # write a starter Testfile from package.json
```

Beyond that core, the same binary covers the special cases:

- **Filters** (`-f`, `-n`, `-t`, `-m`, `--failed`, `--changed`) to run a
  subset of the suite,
- **machine-readable reports** for CI (`--reporter junit|json`),
- **run history** under `.testfile/`, browsed with the read-only
  [`viewer-ts`](../viewer-ts/) sibling (`testfile-viewer runs`, `run`,
  `diff`, `--flaky`, `serve`, `archive pack|import`, `s3 push|pull|list`,
  `github sync|list`),
- **shell completions** (`testfile completion bash|zsh|fish`).

Full documentation:
[christoph-jerolimov.github.io/testfile](https://christoph-jerolimov.github.io/testfile/) —
in particular [Getting started](https://christoph-jerolimov.github.io/testfile/docs/getting-started)
and [CLI & TUI](https://christoph-jerolimov.github.io/testfile/docs/cli).

Requires Node.js >= 20. Apache-2.0.
