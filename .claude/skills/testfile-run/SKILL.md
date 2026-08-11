---
name: testfile-run
description: Run the right subset of a Testfile suite instead of everything. Use when about to run tests in a project with a Testfile - after an edit, before a commit, to check one test, or to follow a long suite while it runs.
---

# Running tests without running everything

A suite that takes minutes should not be run in full after every edit.
Pick the narrowest selection that would catch the mistake you just might
have made, and only widen before you declare the work done.

## Pick the selection

| Situation | Command |
| --------- | ------- |
| you just edited code | `testfile start --changed` |
| you just fixed a failure | `testfile start --failed` |
| you know the test | `testfile start -n ci/unit` |
| a category of tests | `testfile start -t fast` (tags) |
| one matrix instance | `testfile start -m browser:firefox` |
| about to commit / declare done | `testfile start` |

`--changed` selects tests whose declared `inputs` match files changed
against the base branch, plus everything uncommitted; tests without
`inputs` always count as changed. `--failed` keeps only what failed (or
was aborted) in the most recent recorded run. They compose with the other
filters, and a filter that matches nothing is an error rather than a
silent pass.

Preview a selection without running it:

```sh
testfile inspect --changed     # what would run, with tags and matrix
testfile start --dry-run       # ... and which results come from the cache
```

## Long runs

For a suite that takes a while, stream the events instead of waiting for
the summary — the first failure arrives immediately:

```sh
testfile start --json-stream | jq -c 'select(.event == "test-end" and .status == "failed")'
```

Events are one JSON object per line: `run-start`, `test-start`, `line`,
`test-end`, `service`, `run-end`. Human output moves to stderr while
streaming.

`-w` / `--watch` re-runs the current selection whenever a file changes,
which beats re-invoking by hand during a fix-and-check loop.

## Reading the result

The exit code is the answer: `0` passed, `1` failed, `130` interrupted.
Every run is recorded, so when something failed:

```sh
testfile-viewer explain        # what failed, why, what changed
```

Prefer that over re-reading the terminal — it also says whether the test
is known flaky.

## Rules worth keeping

- Never edit a Testfile to make a failure go away unless the *test* is
  what's wrong. Removing a test is not a fix.
- Do not add `retry:` to a test that fails deterministically; that hides a
  bug rather than absorbing a flake.
- If the run needs services (databases, browsers), do not start them by
  hand — the Testfile declares them, and `testfile start` brings them up
  and tears them down.
- Before saying the work is done, run the suite unfiltered at least once.
