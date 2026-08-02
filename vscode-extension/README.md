# Testfile for VS Code

The editor companion of the [Testfile](https://github.com/christoph-jerolimov/testfile)
format and runner.

## Features

- **Schema validation & completion** for `Testfile` / `testfile.yaml` /
  `testfile.yml` (via the bundled JSON schema; needs the
  [YAML extension](https://marketplace.visualstudio.com/items?itemName=redhat.vscode-yaml)).
  `Testfile` files are associated with YAML automatically.
- **Run from the editor**: a `▶ run` code lens above every test runs it (with
  its subtree) via `testfile run -n <path>` in the shared *Testfile* terminal.
  `Testfile: Run Test at Cursor` does the same for the test under the cursor,
  `Testfile: Run All Tests` runs everything.
- **Testfile Runs** view in the explorer: the recorded runs from
  `.testfile/runs/` with per-test status, duration and one-click access to the
  recorded logs. The view refreshes automatically when new runs are recorded.
- Shortcuts to the other frontends: `Testfile: Open the TUI` and
  `Testfile: Serve the Web Viewer`.

## Settings

- `testfile.command` — the CLI to invoke (default `testfile`). Point it at
  `node /path/to/runner-ts/dist/cli.js` when working inside this repository.

## Development

```sh
npm run typecheck   # tsc
npm test            # typecheck + unit tests + bundle
npm run build       # bundle to dist/ and copy the schema
npx @vscode/vsce package   # build the .vsix
```
