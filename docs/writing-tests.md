---
title: Writing tests
order: 1
category: Test definition
description: Commands, scripts, sequences, parallel groups and failure handling.
---

# Writing tests

A test — the root one or any nested one — must contain **exactly one** of
`command`, `script`, `sequence`, `parallel`, [`include`](#composing-testfiles)
or [`foreach`](#one-test-per-folder-or-file).

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

By default everything runs under `sh` (`sh -e` for scripts). `shell` picks
another interpreter — anything that accepts `-c`:

```yaml
- name: bash features
  shell: bash -e
  script: |
    [[ -d dist ]]
    shopt -s globstar
- name: quick python check
  shell: python3
  command: "import json; json.load(open('package.json'))"
```

With a custom shell the implicit `-e` for scripts does not apply — add it
yourself as above.

## Running a test in a container

Tests run on the host by default. `container` runs a test's body inside an
image instead — the same idea as a GitHub Actions job container — so
contributors don't need the right compiler installed locally:

```yaml
- name: go tests
  container:
    image: docker.io/library/golang:1.23
  command: go test ./...
```

The project directory is mounted at `/workspace` and becomes the working
directory (a test with a `workdir` lands in the mounted equivalent of it),
and the test's environment is passed in — minus host-specific variables
like `PATH` and `HOME`, which the image provides itself.

Because the project is mounted, a test body always runs on a **local**
engine (podman or docker, whichever [the run's engine
selection](./services#containers) finds) — even when the run's services are
on a kubernetes cluster, which cannot mount your working copy.

A `container` on a group applies to everything nested below it, so one
declaration can give a whole branch its toolchain:

```yaml
- name: rust
  container:
    image: docker.io/library/rust:1.83
  sequence:
    - name: fmt
      command: cargo fmt --check
    - name: test
      command: cargo test
```

| Field | Description |
| ----- | ----------- |
| `image` | Image to run in (required). |
| `workdir` | Mount point of the project inside the container, default `/workspace`. |
| `env` | Extra variables, on top of the test's own environment. |
| `volumes` | Additional mounts, e.g. a shared package cache. |
| `pull` | `always`, `missing` or `never`. |
| `network` | Container network; defaults to `host`. |
| `options` | Extra engine flags, e.g. `--user 1000:1000`. |

[Services](./services) keep running on the host, so the container joins the
host network by default and a test reaches its database on
`127.0.0.1:${{ ports.db }}` exactly as it would outside. Set `network` if
you need something else — then publish the ports accordingly.

The whole project is mounted, not just the test's `workdir`, so paths that
reach outside it still resolve. Two consequences are worth reading up on
before they surprise you: a test body always runs on a **local** engine
(podman or docker, never a Kubernetes cluster), and the mount is resolved by
whatever machine runs that engine — see
[what containers can see of your project](./services#what-containers-can-see-of-your-project).

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
fails if any of them failed. (The exception is
[`--fail-fast`](./cli-reference#testfile-start-path), which aborts the whole
run at the first failure.)

### Dependencies inside a parallel group

When plain sequence/parallel nesting is too coarse, `needs` turns a parallel
group into a dependency graph:

```yaml
test:
  parallel:
    - name: build
      command: npm run build
    - name: unit
      needs: [build]
      command: npm run test:unit
    - name: e2e
      needs: [build]
      command: npm run test:e2e
    - name: report
      needs: [unit, e2e]
      command: npm run report
```

`unit` and `e2e` start as soon as `build` passed (in parallel with each
other); `report` waits for both. If a needed test fails, its dependents are
skipped — and the skip cascades: a test needing a needs-skipped sibling is
skipped too. A sibling skipped by its `if` condition, or deselected by
filters, counts as satisfied instead. Unknown names, ambiguous names and
cycles are rejected when the Testfile is loaded.

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

## Composing Testfiles

In a monorepo, each package can keep its own Testfile and the root file
stitches them together with `include`:

```yaml
version: 0
test:
  name: all
  sequence:
    - name: packages
      include: packages/*/Testfile   # glob -> parallel group
    - include: ./app                 # single file or directory
```

Included tests run with the included file's directory as working
directory (`workdir` cannot be set on an include test), keep their own
`env` and `services` (scoped to the embedded tests; `env` on the include
test wins over the included file's values), and their named `ports` merge
into the root file's ports — so two files declaring the same `random` port
share one allocation. An included file's top-level `envFile`, `forwardEnv`
and `secrets` are ignored; declare those inside its tests. Includes nest;
cycles and conflicting port definitions are rejected.

## One test per folder or file

`include` embeds a per-package Testfile; `foreach` is for the common case
where the packages have no Testfile of their own but all run the same
commands. It expands a glob into one test per match, generated from a
template:

```yaml
- name: packages
  foreach: packages/*        # matches folders
  template:
    workdir: ${{ each.path }}
    sequence:
      - name: build
        command: npm run build
      - name: test
        command: npm test
```

That runs build and test in `packages/api`, `packages/ui`, … as a parallel
group — the same shape a glob `include` produces, without a file per
package.

Inside the template, `${{ each.* }}` refers to the match:

| Reference | Example for `packages/api` |
| --------- | -------------------------- |
| `${{ each.path }}` | `packages/api` (relative to the Testfile) |
| `${{ each.name }}` | `api` |
| `${{ each.dir }}` | `packages` |
| `${{ each.absolute }}` | `/home/me/project/packages/api` |

A template without its own `name` is named after the match, so the run
tree reads `packages/api`, `packages/ui`.

The long form selects what is matched and what to skip:

```yaml
- name: fixtures
  foreach:
    glob: test/cases/*
    folder: false          # default true; at least one of the two must stay on
    file: true             # default false
    ignore:
      - test/cases/broken  # exact match ...
      - "**/*.tmp"         # ... or a glob
  template:
    name: case ${{ each.name }}
    command: ./run-case.sh ${{ each.path }}
```

Matches are sorted alphabetically, so the generated suite is stable.
Generated tests are ordinary tests: they can carry tags, services,
`inputs`, or contain another `foreach`. A glob that matches nothing is an
error — that is nearly always a typo rather than an empty package set.

## Result caching

Declare what a test depends on, and unchanged inputs skip the test on the
next run:

```yaml
- name: unit
  inputs:
    - src/**/*.ts
    - package.json
  command: npm run test:unit
```

`inputs` goes on `command`/`script` tests only — a group's result is its
children's. The runner hashes the matched files' content together with the
test's configuration; when nothing changed since the last **passing** run,
the test is reported as passed with a `cached` marker instead of re-running.
Failures are never cached, and any change to the files, the command, the
env or the matrix combination re-runs the test. `testfile start --no-cache`
forces execution (and refreshes the cache); combined with
[watch mode](./cli#watch-mode) caching makes the edit-test loop touch only
what actually changed.

Every test with `inputs` states in its log — and as `reason` in the
recorded `run.yaml` — why it ran or didn't: a cache hit, a first run, or
which input pattern saw how many changed files (named individually for
small sets).

**The cache is local to one machine.** It lives in `.testfile/cache.json`
next to the run history, keyed by file hashes on that machine — it only
kicks in when the same suite runs twice on the same checkout. A CI runner
that starts from a fresh clone has an empty cache, so caching does **not**
speed up CI unless you persist and restore `.testfile/cache.json` yourself
(a shared volume, `actions/cache`, or committing it — not recommended). For
CI, use [change-based selection](#change-based-selection) instead: it needs
only the git history, which every CI checkout already has.

## Change-based selection

`testfile start --changed` uses git instead of a warm cache to decide what to
run: it collects every file that differs between a **base branch** and the
current commit, plus everything changed locally (staged, unstaged and
untracked), and selects the tests whose `inputs` patterns match at least
one of those files. Tests without `inputs` always run — the runner cannot
know what they depend on.

- The base branch defaults to the remote's default branch (`origin/HEAD`,
  falling back to `origin/main`, `origin/master`, `main`, `master`);
  `--changed-since <ref>` picks another one, e.g. `--changed-since origin/release-2.0`.
- The diff starts at the merge base (fork point), so commits that are only
  on the base branch don't count as your changes.
- Selected tests log — and record in `run.yaml` — which pattern matched how
  many changed files.
- `testfile changes` shows the exact file list this selection works from,
  see [the CLI reference](./cli#changes).

On a pull request, running with `--changed-since <target branch>` gives CI
runs that only execute the tests your PR could have affected — no shared
cache required. The [GitHub action](./github-action) wires this up
automatically.

## Artifacts

Declare files a test produces — coverage, screenshots, reports — and the
runner keeps them with the [run record](./cli#run-history), also when the
test fails:

```yaml
- name: e2e
  artifacts:
    - playwright-report/**
    - test-results/**/*.png
  command: npm run test:e2e
```

Patterns are globs relative to the test's working directory. Collected
files land in `.testfile/runs/<id>/artifacts/<test>/...` and are listed in
the run's `run.yaml` and in `testfile inspect run <id>`.

## Setup and teardown

`setup` runs before a test's body, `teardown` after it — cleanup included on
failures and Ctrl+C:

```yaml
- name: db tests
  setup:
    command: npm run db:migrate
  teardown:
    command: npm run db:drop
    timeout: 30s
  command: npm run test:db
```

Hooks take one `command` or `script` plus optional `env`, `workdir` and
`timeout`, and they run after the test's services are ready. They always
run with `sh` **on the host** — a test-level `shell` does not apply to
them, and neither does a [test container](#running-a-test-in-a-container),
so whatever a hook calls must exist outside the image. A failing setup
fails the test and skips its body (teardown still runs); a failing
teardown fails an otherwise passing test. On groups, hooks wrap all
children; with a matrix they run per instance.

## Conditional tests

`if` decides whether a test (and its nested tests) runs. A false condition marks
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
- name: locally on linux only
  if: ${{ env.TESTFILE_OS }} == linux && !${{ env.CI }}
  command: npm run test:sandbox
```

Bare values are truthiness checks (`""`, `false`, `0`, `no`, `off` are
false), `==`/`!=` compare strings, and `!` negates. Unknown references
like an unset `env.CI` resolve to `""` instead of erroring. The runner
provides `TESTFILE_OS` and `TESTFILE_ARCH` for platform conditions, and
matrix values work too: `if: ${{ matrix.db }} == postgres`.

Conditions combine with `&&` and `||`, where `&&` binds tighter, and
`(...)` groups them:

```yaml
- name: nightly integration
  if: ${{ env.CI }} && (${{ env.SCHEDULE }} == nightly || ${{ env.FORCE }})
  command: npm run test:integration
```

Operands keep their spaces (`${{ env.NAME }} == my project` compares the
whole value), so a value that contains a literal `&&`, `||` or a
parenthesis has to be quoted: `if: "'a && b' == ${{ env.LABEL }}"`.

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
[`testfile start -t fast`](./cli#filtering) (or just `-f fast`).

## Timeouts, env, workdir

Every test can carry a free-form `description`, and can set a `timeout`
(fails the test and everything nested below it when exceeded — on a test
with a `matrix` it applies per instance, not to the whole fan-out), `env`
(merged over the parent's environment, child wins) and `workdir` (relative
to the Testfile):

```yaml
test:
  name: e2e
  workdir: ./e2e
  timeout: 10m
  env:
    HEADLESS: true
  command: npx playwright test
```
