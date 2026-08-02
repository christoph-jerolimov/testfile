---
title: What is a Testfile?
order: 1
description: A declarative YAML format that describes how your project runs its tests.
---

# What is a Testfile?

A **Testfile** is a YAML file — named `Testfile`, `testfile.yaml` or
`testfile.yml` — that describes how your project runs its tests, checked into
the repository next to your code.

> **Status: under review.** The format is currently at `version: 0` and may
> still change based on feedback. Version 1 is targeted for Q4 2026. Please
> try it on your project and tell us what works and what doesn't in a
> [GitHub issue](https://github.com/christoph-jerolimov/testfile/issues) —
> feedback and contributions are very welcome.

It is built around three ideas:

1. **Tests nest.** The root of the file contains one test. Every test
   either runs a shell command or script, or groups nested tests that run
   in sequence or in parallel — together they form the test suite. A matrix can expand one test into many
   combinations (Node versions × databases, for example).

2. **Tests can need services.** Real test suites need the app under test, a
   database in a specific version, a message broker. A Testfile declares those
   as *services*: local processes or container images (podman/docker; running
   them on Kubernetes is planned). The runner starts them, waits until they
   are actually ready — an HTTP health check, an open TCP port, or a log line —
   and gracefully shuts them down afterwards, even when you hit Ctrl+C.

3. **The environment is explicit.** Environment variables, named ports
   (including randomly allocated free ports), and matrix values are declared
   in the file and injected via `${{ ... }}` templates, so runs are
   reproducible and parallel runs don't fight over ports.

A small but complete example:

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
  name: all
  sequence:
    - name: lint
      command: npm run lint
    - name: e2e
      env:
        BASE_URL: http://localhost:${{ ports.web }}
      command: npm run test:e2e
```

Run it with the [`testfile` CLI](./cli):

```sh
testfile run          # plain output
testfile-viewer tui   # browse recorded runs (read-only terminal UI)
```

Continue with [Getting started](./getting-started), or read the
[full specification](https://github.com/christoph-jerolimov/testfile/blob/main/spec/README.md)
and its [versioning policy](https://github.com/christoph-jerolimov/testfile/blob/main/spec/VERSIONING.md)
— once version 1 ships, the format will evolve additively within it, and a
[conformance suite](https://github.com/christoph-jerolimov/testfile/blob/main/conformance/README.md)
pins its semantics for alternative runner implementations.
