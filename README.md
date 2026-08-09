# Testfile

[![CI](https://github.com/christoph-jerolimov/testfile/actions/workflows/ci.yaml/badge.svg)](https://github.com/christoph-jerolimov/testfile/actions/workflows/ci.yaml)

**Testfile** is a declarative YAML format (`Testfile` / `testfile.yaml` /
`testfile.yml`) that
describes how a project runs its tests:

- Tests form a nested **suite**: each test runs a `command` or `script`, or
  groups nested tests in `sequence` or `parallel`; a **matrix** expands one
  test into many combinations.
- Tests can declare **services** they depend on — the app under test, a
  database in a specific version — as local processes or **containers**.
  Which engine runs them (podman, docker, or pods on a kubernetes cluster)
  is chosen by whoever runs the tests, not by the file. The runner starts
  them, waits for a **ready** signal (HTTP check, TCP port, or a log
  pattern), and **gracefully stops** them, even on Ctrl+C.
- **Env vars, named ports** (including random free ports) and matrix values
  are injected through `${{ ... }}` templates.

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

## Repository layout

| Folder | Contents |
| ------ | -------- |
| [`spec/`](spec/) | The normative specification: the Testfile format and the [test result format](spec/RESULTS.md). |
| [`docs/`](docs/) | End-user documentation, published at [christoph-jerolimov.github.io/testfile](https://christoph-jerolimov.github.io/testfile/). |
| [`schema/`](schema/) | The JSON schema, plus `tests/valid` and `tests/invalid` example files that CI validates on every change. |
| [`website/`](website/) | Astro site that renders `docs/`, published to GitHub Pages. |
| [`runner-ts/`](runner-ts/) | The reference runner: the `testfile` CLI that reads a Testfile, runs processes and records runs, written in TypeScript. |
| [`viewer-ts/`](viewer-ts/) | The read-only `testfile-viewer` CLI over recorded runs: history, terminal UI, web-viewer server and run transfer. |
| [`viewer-web/`](viewer-web/) | The React web viewer over recorded runs, served locally by `testfile-viewer serve`. |
| [`vscode-extension/`](vscode-extension/) | VS Code extension: schema validation, run-from-editor code lenses and the recorded-runs view. |
| [`conformance/`](conformance/) | Runner-independent conformance suite: cases with expected outcomes that any runner implementation must satisfy. |
| [`examples/`](examples/) | Complete example projects for common stacks, schema-validated in CI and rendered on the website. |
| [`ci/`](ci/) | Ready-made pipeline snippets for other CI systems (Jenkins, Buildkite, GitLab, CircleCI). |
| [`action/`](action/) | Helper scripts of the GitHub Action defined in [`action.yml`](action.yml): annotations, the job summary and the run artifact. |

This repository is an npm-workspaces monorepo and eats its own dog food: its
tests are described in [`Testfile`](Testfile).

## Quick start

```sh
npm ci

# validate the schema against all example files
npm test --workspace schema

# build and test the runner
npm test --workspace runner-ts

# run this repository's own Testfile with the runner
node runner-ts/dist/cli.js start        # plain output

# build the viewer and browse the recorded runs
npm run build --workspace viewer-ts
node viewer-ts/dist/cli.js tui

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
- uses: christoph-jerolimov/testfile@main
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

## Feedback and contributing

The format is under review until version 1 (targeted for Q4 2026), and
real-world feedback drives it. If you try Testfile on one of your projects —
or just read the spec — please share your experience in a [GitHub
issue](https://github.com/christoph-jerolimov/testfile/issues). Pull
requests for the spec, schema, docs, runner and conformance suite are
welcome too.

## License

Apache-2.0 — see [LICENSE](LICENSE).
