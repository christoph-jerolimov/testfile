# Testfile

[![CI](https://github.com/testfile-dev/testfile/actions/workflows/ci.yaml/badge.svg)](https://github.com/testfile-dev/testfile/actions/workflows/ci.yaml)

**Testfile** is a declarative YAML format (`Testfile` / `testfile.yaml` /
`testfile.yml`) that describes how a project runs its tests — one file that
works the same on every laptop and in every CI.

```yaml
version: 0
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

## Features

**The format** —
[nested suites](https://testfile.dev/docs/writing-tests)
of `sequence`/`parallel` groups; a
[matrix](https://testfile.dev/docs/matrix)
expands one test into many combinations; `foreach` generates a test per
matching folder or file; `include` composes monorepos from per-package
Testfiles. Conditions (`if` with `&&`/`||`), tags, timeouts, retries,
`continueOnError`, DAG ordering with `needs`, and `setup`/`teardown`
hooks. `${{ env/ports/matrix }}` templates with `||` defaults. A JSON
schema for validation and editor completion — and the whole format is
pinned by a [normative spec](spec/) plus a runner-independent
[conformance suite](conformance/), so other runners can implement it.

**Services & environment** — tests declare the
[services](https://testfile.dev/docs/services)
they need (the app under test, databases in specific versions) as local
processes or containers; which engine runs them — podman, docker, or
**pods on a kubernetes cluster** with ports forwarded to localhost — is
chosen by whoever runs the tests, never by the file. Readiness by HTTP,
TCP, log pattern or command; service-to-service `depends_on`-style
`needs`; instances shared across a matrix; graceful stop, also on Ctrl+C.
Test bodies can run [inside a container](https://testfile.dev/docs/writing-tests#running-a-test-in-a-container)
too. The [environment is isolated](https://testfile.dev/docs/env-and-ports):
explicit `forwardEnv`, env files and first-class `secrets` with masking,
named ports with per-run random allocation.

**Running** — [filters](https://testfile.dev/docs/cli#filtering)
by name, tag or matrix value; re-run `--failed`; git-aware `--changed`
selection; `--shard i/n` across machines; watch mode and a cache-aware
`--dry-run`. [Result caching](https://testfile.dev/docs/writing-tests#result-caching)
by declared `inputs`, collected artifacts, JUnit/JSON reports. Every run
is recorded — `run.yaml`, per-test logs with timing for a timeline,
service logs — and `testfile doctor` checks a machine against what the
file needs before a run finds out the hard way. `testfile init` imports
what a project already has (package.json scripts, docker-compose, GitHub
workflows, Makefiles). Shell completions included.

**CI & viewing** — a [GitHub Action](https://testfile.dev/docs/github-action)
with PR annotations, a job summary, an optional **commit status per
test** and the run uploaded as an artifact; a [Tekton
Task](https://testfile.dev/docs/tekton) that runs the declared services as
pods on the pipeline's own cluster; ready-made snippets for
GitLab, Jenkins, Buildkite and CircleCI. The read-only viewer serves the
recorded runs: a runs table, run diffs, flaky/broken verdicts, a terminal
UI and a [local web viewer](https://testfile.dev/docs/cli#the-web-viewer)
with label/status/variant filters and a timeline. Runs travel: pack them
as archives, push/pull via S3, sync straight from GitHub Actions or
GitLab CI, and merge platform legs into a single verdict. Plus a VS Code
extension with schema validation, run-from-editor and a runs view.

## Repository layout

| Folder | Contents |
| ------ | -------- |
| [`spec/`](spec/) | The normative specification, three documents: the [Testfile format](spec/TESTFILE.md), the [test result format](spec/RESULTS.md) and the [versioning policy](spec/VERSIONING.md). |
| [`docs/`](docs/) | End-user documentation, published at [testfile.dev](https://testfile.dev/). |
| [`schema/`](schema/) | The JSON schema, plus `tests/valid` and `tests/invalid` example files that CI validates on every change. |
| [`website/`](website/) | Astro site that renders `docs/`, published to GitHub Pages. |
| [`testfile-ts/cli/`](testfile-ts/cli/) | The `testfile` command line: running what a Testfile describes, and reading the runs that came out. |
| [`testfile-ts/core/`](testfile-ts/core/) | The recorded-run domain: `run.yaml` types, the history, diffs, flaky verdicts, digests, repro bundles, merging. |
| [`testfile-ts/runner/`](testfile-ts/runner/) | The reference runner as a library: expanding a Testfile into a suite and running it — processes, containers and clusters. |
| [`testfile-ts/sync/`](testfile-ts/sync/) | Moving recorded runs between machines: archives, S3, GitHub and GitLab artifacts. |
| [`testfile-ts/tui/`](testfile-ts/tui/) | The terminal UI over recorded runs (Ink) — the only package that needs a renderer. |
| [`testfile-ts/mcp/`](testfile-ts/mcp/) | The MCP server: read-only tools over the history for an AI assistant. |
| [`testfile-ts/web/`](testfile-ts/web/) | The localhost REST API that serves the web viewer. |
| [`testfile-ts/eve/`](testfile-ts/eve/) | `eve`: ask questions about the recorded runs from a terminal - the MCP tools, driven by an agent instead of an editor. |
| [`testfile-ts/rslib-bundle/`](testfile-ts/rslib-bundle/) | Experimental: the CLI bundled into one file with Rslib (Rspack) - a second opinion on the esbuild bundle. Checked in CI. |
| [`testfile-ts/deno-bundle/`](testfile-ts/deno-bundle/) | Experimental: the CLI as a single binary, built with `deno compile`. Not part of CI. |
| [`testfile-ts/bun-bundle/`](testfile-ts/bun-bundle/) | Experimental: the same, built with `bun build --compile`. Not part of CI. |
| [`testfile-ts/nodejs-bundle/`](testfile-ts/nodejs-bundle/) | Experimental: the same, built by node itself with `--build-sea` (node 25.5+). Not part of CI. |
| [`testfile-ts/scriptc-native/`](testfile-ts/scriptc-native/) | Experimental: `testfile-report`, a 419 KB binary with no JavaScript engine in it, compiled by [scriptc](https://scriptc.dev). Not part of CI. |
| [`testfile-viewer/`](testfile-viewer/) | The React web viewer over recorded runs, served locally by `testfile serve`. |
| [`vscode-extension/`](vscode-extension/) | VS Code extension: schema validation, run-from-editor code lenses and the recorded-runs view. |
| [`conformance/`](conformance/) | Runner-independent conformance suite: cases with expected outcomes that any runner implementation must satisfy. |
| [`examples/`](examples/) | Complete example projects for common stacks, schema-validated in CI and rendered on the website. |
| [`ci/`](ci/) | Ready-made pipeline snippets for other CI systems (Jenkins, Buildkite, GitLab, CircleCI — and GitHub, for pipelines that skip the action). |
| [`action/`](action/) | Helper scripts of the GitHub Action defined in [`action.yml`](action.yml): annotations, the job summary and the run artifact. |
| [`tekton/`](tekton/) | The [Tekton Task](https://testfile.dev/docs/tekton) — the action's sibling for Kubernetes-native CI — with an example pipeline and the RBAC the kubernetes engine needs. |
| [`scripts/`](scripts/) | Checks on the repository itself, run by [`Testfile`](Testfile) like everything else. |

This repository is an npm-workspaces monorepo and eats its own dog food: its
tests are described in [`Testfile`](Testfile).

### Dependencies between the workspaces

The packages depend on each other by name and version — `@testfile.dev/cli`
declares `"@testfile.dev/core": "^0.1.0"` — and npm links those to the folders in
this repository instead of downloading them. There is no `workspace:*` to
write: that protocol is a pnpm/yarn/bun feature, and npm rejects it outright
with `EUNSUPPORTEDPROTOCOL`. A plain range is npm's way of saying it, and it
links as long as the version in the workspace satisfies the range.

The catch is that nothing in npm keeps the two in step — `npm version
--workspaces` bumps the versions and leaves every dependent's range untouched
— and when a range stops matching, npm silently stops linking and looks on the
registry, where none of these names is published:

```
npm error 404  '@testfile.dev/core@0.2.0' is not in this registry
```

So [`scripts/workspaces.test.mjs`](scripts/workspaces.test.mjs) checks it: every
`@testfile.dev/*` dependency names a real workspace, its range is satisfied by that
workspace's version, and the lockfile links all of them. Bump a version without
updating its dependents and that test says so, instead of the next `npm ci`
failing with a 404 that looks like a network problem.

### Running the tests without building

`npm run test:source` runs every test in `testfile-ts/` from `src/`, no build
required — Node strips the types itself, and
[`testfile-ts/from-source.mjs`](testfile-ts/from-source.mjs) fills in the
three things it does not do: resolving a `./x.js` import to `x.ts`, pointing
`@testfile.dev/core` at its source rather than its `dist/`, and handing the TUI's
`.tsx` to esbuild.

It is for the edit-run loop, not for CI, and it is not a speed-up: a full
`npm run test:source` takes about half again as long as building and running
the compiled tests, because every process transforms its own imports. What it
buys is not having to build first — useful on a fresh checkout, and with
`--watch`. **It does not typecheck**: types are stripped, not checked, so
`npm run build` and the suite in [`Testfile`](Testfile) remain the things
that say the code compiles.

## Quick start

```sh
npm ci

# validate the schema against all example files
npm test --workspace schema

# build and test a package (they live in testfile-ts/: core, runner, sync,
# mcp, tui, web, cli - each builds what it depends on)
npm test --workspace @testfile.dev/cli

# ... or run the tests straight from src/, with nothing built
npm run test:source
npm run test:source:watch

# run this repository's own Testfile
node testfile-ts/cli/dist/cli.js start        # plain output

# ... and browse the recorded runs
node testfile-ts/cli/dist/cli.js tui

# build the documentation website
npm run build --workspace website

# lint and format every JavaScript/TypeScript workspace
npm run lint          # oxlint, configured in .oxlintrc.json
npm run format        # oxfmt, configured in .oxfmtrc.json
```

`npm run lint:fix` applies the fixes oxlint can make itself, and
`npm run format:check` is what CI runs — the `lint` and `format` tests in
[`Testfile`](Testfile) call both.

## GitHub Action

This repository doubles as a GitHub Action:

```yaml
- uses: testfile-dev/testfile@main
  with:
    filter-tags: fast
```

See [docs/github-action.md](docs/github-action.md) for all inputs.

## Continuous integration

- [`ci.yaml`](.github/workflows/ci.yaml) runs this repository's own
  Testfile through the bundled action on Linux, macOS and Windows — schema
  validation, runner build & tests, website build and the conformance suite
  (with a kind cluster on the Linux leg for the kubernetes case) — and a
  second job merges the three platform runs into one.
- [`release-vscode.yaml`](.github/workflows/release-vscode.yaml) packages
  and publishes the VS Code extension on `vscode-v*` tags.
- [`deploy-website.yaml`](.github/workflows/deploy-website.yaml) publishes
  the website to GitHub Pages on every push to `main`.
- [`release.yaml`](.github/workflows/release.yaml) drives npm releases with
  [changesets](https://github.com/changesets/changesets) — see below.

## Releases

npm releases are managed with
[changesets](https://github.com/changesets/changesets). A pull request that
changes one of the published packages (`@testfile.dev/schema` and the
`testfile-ts/` libraries and CLI — everything without `"private": true`)
should carry a changeset describing the change and the semver bump it needs:

```sh
npm run changeset
```

This writes a small markdown file into [`.changeset/`](.changeset/) that is
committed with the change and becomes the package's changelog entry.

On every push to `main`, [`release.yaml`](.github/workflows/release.yaml)
collects the pending changesets into a **Version packages** pull request that
applies the bumps (including dependents — bumping `@testfile.dev/core`
patches everything that depends on it) and writes the `CHANGELOG.md` files.
Merging that PR makes the same workflow publish the new versions to npm with
provenance and tag the release. Publishing requires an npm automation token
in the `NPM_TOKEN` repository secret, and opening the Version packages PR
requires the repository setting **Settings → Actions → General → Workflow
permissions → "Allow GitHub Actions to create and approve pull requests"**
to be enabled.

The private workspaces (bundles, viewer, website, conformance) are versioned
along but never published; the VS Code extension keeps its own
tag-driven release via `release-vscode.yaml`.

## Feedback and contributing

The format is under review until version 1 (targeted for Q4 2026), and
real-world feedback drives it. If you try Testfile on one of your projects —
or just read the spec — please share your experience in a [GitHub
issue](https://github.com/testfile-dev/testfile/issues). Pull
requests for the spec, schema, docs, runner and conformance suite are
welcome too.

## License

Apache-2.0 — see [LICENSE](LICENSE).
