---
title: Getting started
order: 2
description: Write your first Testfile and run it.
---

# Getting started

## 1. Create a Testfile

Create a file called `Testfile` (or `testfile.yaml`) in the root of your
project:

```yaml
version: 1
name: my-project
test:
  name: unit tests
  command: npm test
```

Every Testfile needs a `version` (currently always `1`) and exactly one root
`test`.

## 2. Run it

```sh
npx testfile run
```

The runner finds the Testfile in the current directory, runs the tree and
prints a summary. The exit code is `0` when everything passed, `1` on
failure, `130` when you interrupted the run.

Other useful commands:

```sh
testfile validate   # check the file against the JSON schema
testfile list       # print the expanded test tree without running it
testfile run --tui  # interactive terminal UI
```

## 3. Grow the tree

Replace the single command with groups as your test suite grows:

```yaml
version: 1
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
# yaml-language-server: $schema=https://raw.githubusercontent.com/christoph-jerolimov/testfile/main/schema/testfile.schema.json
```
