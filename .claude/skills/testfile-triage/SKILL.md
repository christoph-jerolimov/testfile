---
name: testfile-triage
description: Work out why a Testfile run went red and what to do about it. Use when a run, a test or CI has failed and the question is which failure is real, what caused it, and whether it is worth chasing - including "why did CI fail", "triage the last run", "is this test flaky".
---

# Triaging a failed run

The goal is a verdict a person can act on: **which failure is real, what
caused it, and what to do next**. Not a transcript of what you read.

## 1. Start with the digest, not the logs

```sh
testfile explain
```

One command answers what failed, why, and what changed against the run
before. It puts the leaves that actually broke ahead of the groups that
failed because of them, and it says what the history thinks of each test:
`known flaky — 6/12 of its recent results failed` is a different problem
from a test that has always passed until now.

Only reach for a full log when the digest's excerpt is not enough:

```sh
testfile explain --log-lines 60          # more of each log
testfile inspect run <id> --log ci/unit  # the whole log of one test
```

Use `testfile runs` first if you need to find the run: it lists
them newest first, and `--filter-label branch=main` narrows a history that
collects runs from every branch and CI job.

## 2. Separate the failure from the noise

A red run usually contains one interesting failure and several
consequences of it. Before investigating anything:

- **Groups are not failures.** A `sequence` or `parallel` node fails
  because a child did. Chase the leaf; the digest already sorts it first.
- **A skipped test is not a failure.** `skipped` means a condition was
  false or a `needs` dependency failed — look at what it depended on.
- **Check the verdict before the cause.** If the digest calls a test
  `flaky` or `broken`, the run may say nothing about the change being
  tested. Say so explicitly rather than debugging a coin flip.
- **Look at what changed.** The digest's comparison with the previous run
  distinguishes "this change broke it" from "it was already broken".

## 3. Reproduce before fixing

```sh
testfile repro <run-id> ci/unit
```

This prints the command that reruns exactly that one test, the
environment it needs, the services it declares and the end of its log —
on a merged run, `--variant platform=windows` picks the leg that failed.
Run that command rather than the whole suite: a fast loop is the point.

If it passes locally but failed in CI, the difference is usually in what
`repro` prints: an env var, a service that was not up, a matrix value, or
the platform (`repro` names the machine the run happened on).

## 4. Fix, then verify the way CI will

```sh
testfile start -n ci/unit        # the one test, while iterating
testfile start --failed          # everything that failed last run
testfile start                   # the whole suite, before declaring victory
```

`--failed` re-runs exactly what broke in the most recent run, which is the
right second step after a fix.

## What to report

State the verdict first, then the evidence:

- which test failed, and whether it is a real failure or a known-flaky one
- the cause, in one sentence, with the log line that shows it
- what you changed, or what you would change
- what you ran to confirm it, and the result

If the failure is environmental (a missing binary, a browser that cannot
launch, a service that never became ready), say that plainly — a fix to
the test code would be wrong. `testfile doctor` checks the machine.

Do not claim a fix works without running it. If a test is flaky, do not
re-run it until it passes and call that a fix.
