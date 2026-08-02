---
title: Getting started
order: 2
description: Write your first Testfile and run it.
---

# Getting started

## 1. Create a Testfile

The quickest start is `testfile init`: it inspects your `package.json`
scripts and writes a matching starter Testfile. Or create a file called
`Testfile` (or `testfile.yaml`) in the root of your project yourself:

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

## 2. Run it

```sh
npx testfile run
```

The runner finds the Testfile in the current directory, runs the suite and
prints a summary. The exit code is `0` when everything passed, `1` on
failure, `130` when you interrupted the run.

Other useful commands:

```sh
testfile validate   # check the file against the JSON schema
testfile list       # print the expanded test suite without running it
testfile-viewer tui # browse recorded runs (read-only terminal UI)
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
# yaml-language-server: $schema=https://raw.githubusercontent.com/christoph-jerolimov/testfile/main/schema/testfile.schema.json
```

## 5. Tell us how it went

Testfile is under review on the way to version 1 (targeted for Q4 2026), and
feedback from real projects is what shapes it. If something was confusing,
missing or surprising while you followed this guide, please open a
[GitHub issue](https://github.com/christoph-jerolimov/testfile/issues) —
it genuinely helps.
