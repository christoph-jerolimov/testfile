---
title: "Guided tour: three platforms"
order: 9
description: Run one Testfile on Linux, macOS and Windows in GitHub Actions and merge the three runs into a single result.
---

# Guided tour: three platforms

A test suite that only ever runs on Linux will find Linux bugs. This tour
takes one Testfile, runs it on **Linux, macOS and Windows** in GitHub
Actions, and ends with a **single run** you can open in the viewer — one
verdict, one duration, every test tagged with the platform it ran on.

It is the setup this repository uses for itself; the finished workflow is
[`.github/workflows/ci.yaml`](https://github.com/christoph-jerolimov/testfile/blob/main/.github/workflows/ci.yaml)
(which adds two extras this tour skips: [per-test commit
statuses](./github-action#a-status-per-test) and a kind cluster for the
kubernetes conformance case).

## 1. A Testfile that says what needs Linux

Nothing in the format is platform-specific — the same file runs
everywhere. What differs is what a platform *can* run: the macOS runners
have no container engine, and the Windows runners only run Windows
images, so containerised tests cannot work there. Say so in the Testfile
with an [`if` condition](./writing-tests#conditional-tests) on `TESTFILE_OS`
(`linux`, `darwin` or `win32`), and those tests are reported as skipped
instead of failing:

```yaml
version: 0
test:
  name: ci
  parallel:
    - name: unit
      command: npm test

    - name: integration
      # containers are Linux-only on GitHub's runners
      if: ${{ env.TESTFILE_OS }} == linux
      services:
        db:
          container: { image: postgres:16 }
          ready: { tcp: 5432 }
      command: npm run test:integration
```

Commands still run in a POSIX shell on Windows — the `sh` of the Git
installation every runner has — so `command:` and `script:` need no
special casing.

## 2. One job, three platforms

A matrix job runs the whole file on each platform. Two inputs matter:

- **`variants`** — what tells the three runs apart. Without it the three
  recorded runs look identical, and merging them cannot know which result
  came from where.
- **`artifact-name`** — artifact names are unique per workflow run, so
  each leg needs its own.

```yaml
jobs:
  ci:
    name: Testfile CI (${{ matrix.os }})
    strategy:
      fail-fast: false # one red platform must not hide the others
      matrix:
        os: [ubuntu-latest, macos-latest, windows-latest]
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v7
      - uses: christoph-jerolimov/testfile@main
        with:
          variants: platform=${{ matrix.os }}
          artifact-name: testfile-run-${{ matrix.os }}
```

Each leg uploads its run folder — `run.yaml`, the per-test logs, the
JUnit XML — as its own artifact.

## 3. Merge the three runs into one

Three artifacts are three runs. The merge job downloads them and combines
them into a single run folder, which it uploads like any other run:

```yaml
  merge:
    needs: ci
    if: always() # a merged run with one red leg is the interesting one
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with: { node-version: 22 }
      - run: npm ci --no-audit --no-fund
      - run: npm run build --workspace viewer-ts
      # every artifact unpacks into its own folder, and each of those IS a
      # run folder (run.yaml next to the logs)
      - uses: actions/download-artifact@v8
        with:
          pattern: testfile-run-*
          path: downloaded
      - name: Merge the runs into one
        id: merge
        run: |
          runs=(downloaded/testfile-run-*)
          if node viewer-ts/dist/cli.js merge "${runs[@]}" --dir .; then
            echo "passed=true" >> "$GITHUB_OUTPUT"
          else
            echo "passed=false" >> "$GITHUB_OUTPUT"
          fi
          dir=$(ls -d .testfile/runs/*-merged | head -1)
          echo "dir=$dir" >> "$GITHUB_OUTPUT"
          echo "id=$(basename "$dir")" >> "$GITHUB_OUTPUT"
      - uses: actions/upload-artifact@v7
        with:
          name: testfile-run-merged
          path: ${{ steps.merge.outputs.dir }}
          if-no-files-found: error
      - name: Fail when a platform failed
        if: steps.merge.outputs.passed != 'true'
        run: exit 1
```

The merge writes the artifact first and turns the verdict into the job's
result afterwards, so the merged run exists even when a platform failed —
that is exactly the run worth looking at.

## 4. What the merged run looks like

`merge` prints what it combined:

```
merged run 20260805-101500-merged
  passed  20260805-101500-a1c3  [platform=ubuntu-latest]  1m12s
  passed  20260805-101502-b2d4  [platform=macos-latest]   1m30s
  failed  20260805-101501-c3e5  [platform=windows-latest] 1m45s
failed (exit code 1), 36 tests, 4m27s
```

The result is an ordinary run folder. Download the `testfile-run-merged`
artifact, unpack it into `.testfile/runs/`, and every viewer shows it:

```sh
testfile-viewer inspect run 20260805-101500-merged   # the tests, per platform
testfile-viewer tui                                  # browse it in the terminal
testfile-viewer serve                                # ... or in the browser
```

Each test appears once per platform, tagged with its variant, and the run
header lists what was combined. In `run.yaml`:

```yaml
merged:
  runs:
    - id: 20260805-101500-a1c3
      variants: { platform: ubuntu-latest }
      status: passed
    # ...
  variants:
    platform: [macos-latest, ubuntu-latest, windows-latest]
tests:
  - path: ci/unit
    status: passed
    variants: { platform: ubuntu-latest }
    origin: 20260805-101500-a1c3
  - path: ci/unit
    status: failed
    variants: { platform: windows-latest }
    origin: 20260805-101501-c3e5
```

Rather than downloading artifacts by hand,
[`testfile-viewer github sync`](./github-action#bringing-ci-runs-home)
pulls them — including the merged one — straight into your local history.

## Merging shards

The same command merges [shards](./cli#sharding-across-machines). Sharding splits the
suite, so no test appears twice and **no variants are needed**:

```sh
testfile start --shard 1/3 &   # on three machines
testfile start --shard 2/3 &
testfile start --shard 3/3 &
testfile-viewer merge run-1 run-2 run-3
```

Variants are only required when two runs recorded the *same* test path —
merging refuses that otherwise, because the merged run could not say
which result belonged to which machine:

```
✘ runs 20260805-101500-a1c3 and 20260805-101501-c3e5 both recorded "ci/unit"
  - give the runs distinct --variant values (e.g. --variant platform=linux)
```

Nothing stops you from combining both: shard *and* run the shards on
several platforms. Give every leg `--variant platform=…`, and each
platform's shards merge because their tests are disjoint, while the
platforms merge because their variants differ.
