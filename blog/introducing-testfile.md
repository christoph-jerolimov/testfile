---
title: "Introducing Testfile: one file that runs your tests everywhere"
date: 2026-08-18
description: Why a project's test setup deserves one declarative file, the three ideas the format is built on, and how to try it on your project in five minutes.
---

# Introducing Testfile: one file that runs your tests everywhere

Ask a project "how do I run your tests?" and the answer is usually spread
across five places: a paragraph in the README ("start Postgres first"), a
couple of package scripts or Makefile targets, a docker-compose file, a CI
workflow — and some tribal knowledge that never got written down at all.
The CI workflow is typically the only *complete* answer, and it is written
in a dialect only that CI system runs. Your laptop can't execute it, and
neither can the next CI system you migrate to.

**Testfile** puts that answer in one declarative YAML file, checked into
the repository next to your code, that runs the same on every laptop and
in every CI:

```yaml
version: 0
name: my-app
ports:
  web: random
services:
  web:
    command: npm start
    env:
      PORT: ${{ ports.web }}
    ready:
      http: http://localhost:${{ ports.web }}/healthz
test:
  sequence:
    - name: lint
      command: npm run lint
    - name: e2e
      env:
        BASE_URL: http://localhost:${{ ports.web }}
      command: npm run test:e2e
```

Run `testfile run` in this project and the runner starts the app, waits
until its health check actually answers, runs lint and the end-to-end
tests against it, shuts everything down — and records the whole run,
logs and timings included. The same command, from the same file, does
the same thing in GitHub Actions, GitLab, Jenkins, or on the machine of
a contributor who cloned the repository five minutes ago.

## Three ideas

The format is built around three ideas, and most of what it can do
follows from them.

**Tests nest.** The file contains one root test. Every test either runs
a command or groups nested tests that run in
[sequence or in parallel](../docs/writing-tests.md) — together they form
the suite. A [matrix](../docs/matrix.md) can expand one test into many
combinations (Node versions × databases), and monorepos compose a suite
from per-package Testfiles.

**Tests can need services.** Real suites need the app under test, a
database in a specific version, a message broker. A Testfile declares
those as [services](../docs/services.md) — local processes or container
images — with a readiness check: HTTP, TCP, a log pattern or a command.
The runner starts them, waits until they are genuinely ready, and stops
them gracefully afterwards, even when you hit Ctrl+C. Which engine runs
a container — podman, docker, or pods on a Kubernetes cluster — is chosen
by whoever runs the tests, never hard-coded in the file.

**The environment is explicit.** Environment variables, secrets and named
ports are [declared in the file](../docs/env-and-ports.md) and injected
via `${{ ... }}` templates. Ports can be allocated randomly per run, so
parallel runs on one machine don't fight over port 3000; the environment
is isolated by default, so a run doesn't silently depend on whatever
happened to be exported in your shell.

Because the file is declarative, everything else can be generic: filter
tests [by name, tag or matrix value](../docs/cli.md), re-run only what
failed, shard the suite across machines, view any recorded run in a
terminal UI or a local web viewer, and drop the same file into
[GitHub Actions](../docs/github-action.md) or
[any other CI](../docs/ci-systems.md) with a two-line job.

## Testfile is a format, not just a tool

The `testfile` command line is the reference implementation, but the
format itself is pinned by a [normative specification](../spec/TESTFILE.md)
and a runner-independent conformance suite, so other runners can
implement it and be checked against the same rules. The file you write
is not coupled to our runner any more than it is to a CI vendor.

## Try it — and help us get to version 1

Every Testfile today says `version: 0`: the format is under review, with
version 1 targeted for Q4 2026. This is exactly the moment where trying
it on a real project helps the most — the feedback we get now shapes
what version 1 keeps, fixes and drops.

Three ways in, in increasing order of typing:

- The [wizard](https://testfile.dev/start) asks a handful of questions
  and hands you a starter file.
- `testfile init` imports what your project already has — package
  scripts, docker-compose, Makefiles, GitHub workflows.
- Or write the file by hand, starting from
  [Getting started](../docs/getting-started.md).

If something doesn't work — `init` misread your setup, a service never
became ready, the format can't say what your suite needs —
[open an issue](https://github.com/testfile-dev/testfile/issues). A
failed five-minute experiment, reported, is worth more to us right now
than a polished success story.
