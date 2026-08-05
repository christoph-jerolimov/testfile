# Testfile for VS Code

The editor companion of the [Testfile](https://github.com/christoph-jerolimov/testfile)
format and runner.

## Features

- **Schema validation & completion** for `Testfile` / `testfile.yaml` /
  `testfile.yml` (via the bundled JSON schema; needs the
  [YAML extension](https://marketplace.visualstudio.com/items?itemName=redhat.vscode-yaml)).
  `Testfile` files are associated with YAML automatically.
- **Run from the editor**: a `▶ run` code lens above every test runs it (with
  its nested tests) via `testfile run -n <path>` in the shared *Testfile* terminal.
  `Testfile: Run Test at Cursor` does the same for the test under the cursor,
  `Testfile: Run All Tests` runs everything.
- **Testfile Runs** view in the explorer: the recorded runs from
  `.testfile/runs/` with per-test status, duration and one-click access to the
  recorded logs. The view refreshes automatically when new runs are recorded.
- **`Testfile: Check This Machine (doctor)`** runs `testfile doctor` in the
  terminal: what this Testfile needs (container engine, fixed ports, shells,
  git, a writable `.testfile/`) and what of it is missing.
- Shortcuts to the other frontends: `Testfile: Open the TUI` and
  `Testfile: Serve the Web Viewer`.

## Settings

- `testfile.command` — the CLI to invoke (default `testfile`). Point it at
  `node /path/to/runner-ts/dist/cli.js` when working inside this repository.

## Installing

The extension is published to [Open VSX](https://open-vsx.org/) as
`testfile.testfile-vscode`, so it installs directly in VSCodium, Gitpod,
Eclipse Theia, code-server and friends. VS Code users can install the same
`.vsix` from a GitHub release via *Extensions: Install from VSIX...*.

## Development

```sh
npm run typecheck   # tsc
npm test            # typecheck + unit tests + bundle
npm run build       # bundle to dist/ and copy the schema
npm run package     # build the .vsix (vsce)
```

## Publishing

Pushing a `vscode-v*` tag runs the release workflow
(`.github/workflows/release-vscode.yaml`): it packages the `.vsix`,
publishes it to Open VSX (when the `OVSX_PAT` repository secret is set)
and to the VS Marketplace (when `VSCE_PAT` is set), and attaches the file
to a GitHub release. Manual publishing:

```sh
# one-time: create the namespace on open-vsx.org
npx ovsx create-namespace testfile --pat "$OVSX_PAT"

OVSX_PAT=... npm run publish:open-vsx
VSCE_PAT=... npm run publish:marketplace
```
