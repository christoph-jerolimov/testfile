# Testfile

[![CI](https://github.com/christoph-jerolimov/testfile/actions/workflows/ci.yaml/badge.svg)](https://github.com/christoph-jerolimov/testfile/actions/workflows/ci.yaml)

**Testfile** is a declarative YAML format (`Testfile` / `testfile.yaml`) that
describes how a project runs its tests:

- Tests form a **tree**: each node runs a `command` or `script`, or groups
  sub-tests in `sequence` or `parallel`; a **matrix** expands one test into
  many combinations.
- Tests can declare **services** they depend on — the app under test, a
  database in a specific version — as local processes or **containers**
  (podman/docker today, kubernetes planned). The runner starts them, waits
  for a **ready** signal (HTTP check, TCP port, or a log pattern), and
  **gracefully stops** them, even on Ctrl+C.
- **Env vars, named ports** (including random free ports) and matrix values
  are injected through `${{ ... }}` templates.

```yaml
version: 1
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
| [`spec/`](spec/) | The normative specification of the Testfile format. |
| [`docs/`](docs/) | End-user documentation (rendered by the website). |
| [`schema/`](schema/) | The JSON schema, plus `tests/valid` and `tests/invalid` example files that CI validates on every change. |
| [`website/`](website/) | Astro site that renders `docs/`, published to GitHub Pages. |
| [`runner-ts/`](runner-ts/) | The reference runner: a `testfile` CLI with an interactive TUI, written in TypeScript. |
| [`conformance/`](conformance/) | Runner-independent conformance suite: cases with expected outcomes that any runner implementation must satisfy. |

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
node runner-ts/dist/cli.js run          # plain output
node runner-ts/dist/cli.js run --tui    # interactive TUI

# build the documentation website
npm run build --workspace website
```

## GitHub Action

This repository doubles as a GitHub Action:

```yaml
- uses: christoph-jerolimov/testfile@main
  with:
    filter-tags: fast
```

See [docs/github-action.md](docs/github-action.md) for all inputs.

## Continuous integration

- [`ci.yaml`](.github/workflows/ci.yaml) validates the schema against every
  example (valid files must pass, invalid ones must be rejected), builds and
  tests the runner, and builds the website.
- [`deploy-website.yaml`](.github/workflows/deploy-website.yaml) publishes
  the website to GitHub Pages on every push to `main`.

## License

Apache-2.0 — see [LICENSE](LICENSE).
