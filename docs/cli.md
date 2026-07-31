---
title: CLI & TUI
order: 7
description: The testfile command line runner and its interactive terminal UI.
---

# CLI & TUI

The reference runner lives in
[`runner-ts`](https://github.com/christoph-jerolimov/testfile/tree/main/runner-ts)
and installs a `testfile` binary.

## Commands

```sh
testfile run [path]        # run the tree (default command)
testfile run --tui         # interactive terminal UI
testfile run --verbose     # also stream service output
testfile validate [path]   # validate against the JSON schema
testfile list [path]       # print the expanded tree, incl. matrix instances
```

`path` may be a Testfile or a directory containing one (`Testfile`,
`testfile.yaml` or `testfile.yml`); it defaults to the current directory.

Exit codes: `0` all tests passed · `1` failures or a service that would not
start · `130` interrupted.

## Plain output

Without `--tui` the runner streams progress line by line — suitable for CI
logs. Test output is prefixed with `[test name]`; service output is shown
with `--verbose`, and the tail of a failing service's log is always printed.
A summary tree with per-test durations is printed at the end.

## The TUI

`testfile run --tui` opens a two-pane terminal UI:

- The **left pane** lists the whole test tree (including matrix instances)
  and, below it, every service with its state — starting, ready, stopping,
  stopped, failed.
- The **right pane** follows the output of whatever is selected. Switch
  between running tests and services with the arrow keys (or `j`/`k`) to
  watch any of them live.

Keys:

| Key       | Action |
| --------- | ------ |
| `↑`/`↓` (`k`/`j`) | Select a test or service. |
| `q` / Ctrl+C      | Stop the run gracefully; press again to force-kill. After the run: quit. |

## Interrupting a run

The first Ctrl+C aborts running tests and shuts down all services through
their configured `stop` behavior (signal, grace period, then SIGKILL;
`podman stop`/`docker stop` for containers). A second Ctrl+C skips the grace
period and kills everything immediately.
