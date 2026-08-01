---
title: Writing tests
order: 3
description: Commands, scripts, sequences, parallel groups and failure handling.
---

# Writing tests

A test is a node in the tree. It must contain **exactly one** of `command`,
`script`, `sequence` or `parallel`.

## Commands and scripts

```yaml
test:
  name: unit
  command: npm test
```

`command` is a single shell command. `script` is a multi-line shell script
executed with `sh -e`, so the first failing line fails the test:

```yaml
test:
  name: integration
  script: |
    ./scripts/migrate.sh
    npm run test:integration
```

Both pass when they exit with code `0`.

## Sequences

```yaml
test:
  sequence:
    - name: build
      command: npm run build
    - name: test
      command: npm test
```

Children run in order. The first failure stops the sequence: the remaining
children are reported as *skipped* and the sequence fails.

## Parallel groups

```yaml
test:
  parallel:
    - name: lint
      command: npm run lint
    - name: unit
      command: npm run test:unit
    - name: typecheck
      command: npx tsc --noEmit
  maxParallel: 2
```

Children run concurrently; `maxParallel` caps how many run at once. A failing
child does not cancel its siblings — the group waits for all children and
fails if any of them failed.

## Tolerating failures

`continueOnError: true` reports a test's failure without failing its parent —
useful for cleanup steps or known-flaky checks:

```yaml
sequence:
  - name: test
    command: npm test
  - name: cleanup
    continueOnError: true
    command: rm -rf tmp
```

## Conditional tests

`if` decides whether a test (and its subtree) runs. A false condition marks
it *skipped* without failing anything:

```yaml
- name: only in ci
  if: ${{ env.CI }}
  command: npm run test:ci
- name: only on linux
  if: ${{ env.TESTFILE_OS }} == linux
  command: npm run test:linux
- name: not in ci
  if: "!${{ env.CI }}"
  command: npm run test:local
```

Bare values are truthiness checks (`""`, `false`, `0`, `no`, `off` are
false), `==`/`!=` compare strings, and a leading `!` negates the whole
expression. Unknown references like an unset `env.CI` resolve to `""`
instead of erroring. The runner provides `TESTFILE_OS` and `TESTFILE_ARCH`
for platform conditions, and matrix values work too:
`if: ${{ matrix.db }} == postgres`.

## Retries

Flaky tests can be retried instead of failing the run:

```yaml
- name: flaky check
  tags: [flaky]
  retry: 2                 # up to 2 additional attempts
  command: npm run test:flaky
- name: careful check
  retry:
    count: 3
    delay: 5s              # wait between attempts
  command: npm run test:integration
```

`retry` only applies to `command`/`script` tests. The test passes as soon as
one attempt passes and fails when the last attempt fails; each retry is
noted in the test's log.

## Tags

Tag tests with any labels made of letters and digits — `fast`/`slow`,
`flaky`, `nightly`, `aws`/`gcp`, whatever fits your suite — to run subsets
later:

```yaml
test:
  sequence:
    - name: unit
      tags: [fast]
      command: npm run test:unit
    - name: e2e
      tags: [slow, nightly]
      command: npm run test:e2e
```

A tag on a group applies to all tests below it. Run a subset with
[`testfile run -t fast`](./cli#filtering) (or just `-f fast`).

## Timeouts, env, workdir

Every test can set a `timeout` (fails the subtree when exceeded), `env`
(merged over the parent's environment, child wins) and `workdir` (relative to
the Testfile):

```yaml
test:
  name: e2e
  workdir: ./e2e
  timeout: 10m
  env:
    HEADLESS: true
  command: npx playwright test
```
