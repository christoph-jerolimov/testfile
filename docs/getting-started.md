---
title: Getting started
order: 2
description: Write your first Testfile and run it.
---

# Getting started

## 1. Create a Testfile

Three ways in, in increasing order of typing:
[the wizard](https://testfile.dev/start) asks
a handful of questions and hands you a file to copy; `testfile init` converts what
your project already has; or create a file called `Testfile` (or
`testfile.yaml`) in the root of your project yourself:

```yaml
version: 0
name: my-project
test:
  name: unit tests
  command: npm test
```

Every Testfile needs a `version` (currently always `0` while the format is
under review — version 1 is targeted for Q4 2026) and exactly one root
`test`.

### Importing what you have

`testfile init` looks for files that already describe your setup and
converts them, so the first version is rarely empty:

| Source | Becomes |
| ------ | ------- |
| `package.json` scripts | tests for `lint`, `typecheck`, `test`, `test:*`, `build` |
| `compose.yaml` / `docker-compose.yaml` | `services` — image, ports (as [random ports](./env-and-ports#named-ports)), env, volumes, command/entrypoint, `healthcheck` → [`ready`](./services#readiness-checks), `depends_on` → [`needs`](./services#service-dependencies); a published port without a healthcheck becomes a `tcp` check |
| `.github/workflows/*.yaml` | one test per job, its `run:` steps as a sequence (`uses:` steps are dropped). Auto-detection picks the first workflow it finds; pass others with `--from` |
| `Makefile`, `Taskfile.yaml`, `justfile` | tests for targets that look like checks (`test`, `lint`, `check`, `e2e`, …) |

```sh
npx @testfile.dev/cli init                             # auto-detect all of the above
npx @testfile.dev/cli init --from docker-compose.yml   # just this file
npx @testfile.dev/cli init --no-detect                 # package.json scripts only
```

The conversion is deliberately best-effort: anything that could not be
translated — a service with neither health check nor ports, dropped action steps, a
build matrix — is written into the file as a `# note:` comment and printed,
so you know where to look. Read the result before trusting it.

## 2. Run it

```sh
npx @testfile.dev/cli start
```

The runner finds the Testfile in the current directory, runs the suite and
prints a summary. The exit code is `0` when everything passed, `1` on
failure, `130` when you interrupted the run.

The whole `testfile` command line ships as the
[`@testfile.dev/cli`](https://www.npmjs.com/package/@testfile.dev/cli)
package: `npx` runs it without installing, and
`npm install -g @testfile.dev/cli` puts plain `testfile` on your `PATH` —
which is how the rest of the documentation writes the commands. (A CI job
that only runs the suite can use the leaner `@testfile.dev/runner`
instead — see [CI systems](./ci-systems).)

Other useful commands:

```sh
testfile validate   # check the file against the JSON schema
testfile doctor     # check this machine against what the file needs
testfile inspect    # print the expanded test suite without running it
testfile tui # browse recorded runs (read-only terminal UI)
```

## 3. Grow the suite

Replace the single command with groups as your test suite grows:

```yaml
version: 0
test:
  name: all
  sequence:
    - name: build
      command: npm run build
    - name: checks
      parallel:
        - name: lint
          command: npm run lint
        - name: unit
          command: npm run test:unit
```

`sequence` runs children one after another and stops at the first failure;
`parallel` runs them concurrently. Groups nest arbitrarily — see
[Writing tests](./writing-tests).

## 4. Editor support

Most YAML language servers pick up the schema from a modeline. Add this as
the first line of your Testfile to get completion and validation while
typing:

```yaml
# yaml-language-server: $schema=https://testfile.dev/next/testfile.schema.json
```
