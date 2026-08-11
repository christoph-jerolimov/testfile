---
name: testfile-author
description: Write or extend a Testfile - the declarative YAML test suite. Use when asked to add a test, set up Testfile for a project, convert CI workflows/Makefiles/docker-compose into a Testfile, or when editing a Testfile and unsure which key to use.
---

# Writing a Testfile

A Testfile describes *what to run and what it needs*, not how a particular
CI system runs it. Keep it declarative: no orchestration in shell if a key
already expresses it.

## Before writing anything

- **Look for an importer first.** `testfile init` reads an existing
  `docker-compose.yml`, GitHub workflow, Makefile or package.json and
  writes a starting Testfile. Converting by hand what a tool converts
  better wastes the user's time.
- **Read the schema, not your memory.** `schema/testfile.schema.json` is
  authoritative, and `testfile validate` checks a file against it.
- **Match the project.** If a Testfile already exists, follow its naming,
  its tag vocabulary and its structure rather than introducing a second
  style.

## The shape

A test contains **exactly one** of `command`, `script`, `sequence`,
`parallel`, `include` or `foreach`.

```yaml
version: 0
test:
  name: ci
  tags: [ci]
  sequence:
    - name: build
      command: npm run build
      inputs: ["src/**", "package.json"]
    - name: test
      parallel:
        - { name: unit, command: npm test, tags: [fast] }
        - { name: e2e, command: npm run e2e, tags: [slow], services: [db] }
```

- `sequence` stops at the first failure; `parallel` runs everything and
  aggregates. Use `needs` inside a parallel group when one member depends
  on another.
- `matrix` expands one test per combination; `foreach` generates one per
  matching folder or file. Prefer either over copy-pasted near-identical
  tests.
- `services` declares what a test needs running (with readiness checks);
  do not start a database from a `script`.
- `inputs` is what makes caching and `--changed` work — declare the files
  a test actually depends on.
- `artifacts` keeps files from a run (reports, traces, screenshots).
- `setup`/`teardown` run around a test; teardown runs even on failure.

## Keys people reach for wrongly

| Instead of | Use |
| ---------- | --- |
| `sleep 5` before hitting a service | the service's `ready` check |
| a shell loop over directories | `foreach` |
| several copies of a test with different env | `matrix` |
| `command: docker run …` | `container:` on the test, or a `service` |
| retrying by hand in a script | `retry:` — but only for genuinely flaky tests |
| `if [ "$CI" = true ]` inside a script | `if:` on the test |

## Always, before saying it works

```sh
testfile validate            # schema + structure
testfile inspect             # the expanded suite: matrix, tags, services
testfile start -n <new-test> # actually run what you added
```

A Testfile that validates but was never run is not finished. `inspect` is
the cheap way to confirm a `matrix` or `foreach` expanded into what you
meant.

## Conventions that age well

- Name tests for what they check (`unit`, `migrations`), not for the tool.
- Tag by cost and kind (`fast`, `slow`, `e2e`, `flaky`) so callers can
  select with `-t`.
- Keep the root test a `sequence` whose first step is the cheapest check —
  a fast failure is worth more than a thorough one that comes later.
- Put a `timeout` on anything that talks to the network.
