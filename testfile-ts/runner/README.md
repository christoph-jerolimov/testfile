# @testfile.dev/runner

The reference runner for the
[Testfile](https://github.com/testfile-dev/testfile) format: it runs the
test suite described in your `Testfile` / `testfile.yaml` — starting the
services tests depend on, waiting for their readiness checks and stopping
them gracefully. It is a library first (the VS Code extension and the CI
wrappers drive it without a shell), and it ships its own thin command
line over the commands that read or run the file — which is why a CI job
needs nothing but this package:

```sh
npx @testfile.dev/runner start        # run the suite, stream progress, record the run
npx @testfile.dev/runner start -w -f unit   # watch mode + filter: a tight edit-test loop
npx @testfile.dev/runner validate     # check the file against the JSON schema
npx @testfile.dev/runner doctor       # check this machine against what the file needs
npx @testfile.dev/runner init         # write a starter Testfile from package.json
```

(Installed, the command is called `testfile-runner`.) Beyond that core,
the same commands cover the special cases:

- **Filters** (`-f`, `-n`, `-t`, `-m`, `--failed`, `--changed`) to run a
  subset of the suite,
- **machine-readable reports** for CI (`--reporter junit|json`),
- **shell completions** (`completion bash|zsh|fish`).

Every run is recorded under `.testfile/`; reading that history — `runs`,
`explain`, `diff`, `--flaky`, the TUI, `serve`, `archive pack|import`,
`s3 push|pull|list`, `github sync|list` — is the read-only half of the
tool and lives in the [`cli`](../cli/) sibling, whose `testfile` command
also includes everything here.

Full documentation:
[testfile.dev](https://testfile.dev/) —
in particular [Getting started](https://testfile.dev/docs/getting-started)
and [CLI & TUI](https://testfile.dev/docs/cli).

Requires Node.js >= 20. Apache-2.0.
