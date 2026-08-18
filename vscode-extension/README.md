# Testfile for VS Code

The editor companion of the [Testfile](https://github.com/testfile-dev/testfile)
format and runner.

## Features

- **Schema validation & completion** for `Testfile` / `testfile.yaml` /
  `testfile.yml`, and for recorded `run.yaml` files under `.testfile/runs/`
  (via the bundled JSON schemas; needs the
  [YAML extension](https://marketplace.visualstudio.com/items?itemName=redhat.vscode-yaml)).
  `Testfile` files are associated with YAML automatically.
- **Run from the editor**: a `▶ run` code lens above every test runs it (with
  its nested tests) via `testfile start -n <path>` in the shared *Testfile* terminal.
  `Testfile: Run Test at Cursor` does the same for the test under the cursor,
  `Testfile: Run All Tests` runs everything.
- **Testfile Runs** view in the explorer: the recorded runs from
  `.testfile/runs/` with per-test status, duration and one-click access to the
  recorded logs. The view refreshes automatically when new runs are
  recorded (`Testfile: Refresh Runs` forces it).
- **`Testfile: Check This Machine (doctor)`** runs `testfile doctor` in the
  terminal: what this Testfile needs (container engine, fixed ports, shells,
  git, a writable `.testfile/`) and what of it is missing.
- Shortcuts to the other frontends: `Testfile: Open the Viewer TUI` and
  `Testfile: Serve the Web Viewer`.

## Settings

- `testfile.command` — the CLI to invoke (default `testfile`). Point it at
  `node /path/to/testfile-ts/cli/dist/cli.js` when working inside this
  repository. Every command uses it, the TUI and web viewer shortcuts
  included — they are subcommands of the same CLI.

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

### Trying the packaged extension

`npm run package` writes `vscode-extension/testfile-vscode-<version>.vsix`.
Installing that file is the only way to try what users actually get: the
bundle from `dist/`, the schemas copied next to it, and the `contributes`
section as `package.json` declares it.

You do not have to build it yourself: every change to this workspace is
packaged by
[`build-vscode.yaml`](../.github/workflows/build-vscode.yaml), which keeps
the `.vsix` as a build artifact for 14 days (and runs on demand from the
Actions tab, for any branch). The artifact downloads as a **zip around the
`.vsix`** — unzip it first, then install as below. The run's summary repeats
these commands.

**From the VS Code UI** — open the Extensions view (`Ctrl`/`Cmd`+`Shift`+`X`),
the `...` menu in its title bar, *Install from VSIX...*, and pick the file.
Reload when asked.

**From the command line** — the same thing, minus the clicking:

```sh
code --install-extension testfile-vscode-0.1.0.vsix --force
code --uninstall-extension testfile.testfile-vscode
```

`--force` replaces an install of the same version, which is what you want
while iterating: the version in `package.json` does not change between
builds, so without it a second install is ignored. `codium`, `code-insiders`
and Cursor take the same flags.

### Where an installed extension lands

| | |
| ---------- | ----------------------------------- |
| Linux, macOS | `~/.vscode/extensions/` |
| Windows | `%USERPROFILE%\.vscode\extensions\` |

VSCodium uses `~/.vscode-oss/extensions/` and Insiders
`~/.vscode-insiders/extensions/`; `--extensions-dir <path>` overrides all of
them, which is the tidy way to try a build without touching your everyday
editor:

```sh
code --extensions-dir /tmp/testfile-ext --install-extension testfile-vscode-0.1.0.vsix
code --extensions-dir /tmp/testfile-ext .
```

**Copying the `.vsix` into that folder does nothing.** A `.vsix` is a zip
whose payload sits under `extension/`, and the editor only scans the folder
for *directories* holding a `package.json`. To install one by hand, extract
that inner folder to `<extensions-dir>/testfile.testfile-vscode-0.1.0/` —
`<publisher>.<name>-<version>` — and restart the editor:

```sh
unzip -q testfile-vscode-0.1.0.vsix -d /tmp/vsix
mv /tmp/vsix/extension ~/.vscode/extensions/testfile.testfile-vscode-0.1.0
```

Either way, check it took: the Extensions view lists *Testfile* under
Installed, and opening a `Testfile` gives you completion and the `▶ run`
code lens. `Developer: Show Running Extensions` confirms it activated —
that only happens in a folder that contains a `Testfile`, `testfile.yaml`
or `testfile.yml`, per `activationEvents`.

## Publishing

Building and releasing are two workflows: `build-vscode.yaml` above packages
every change into a throwaway artifact, and this one publishes.

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

## Which VS Code it needs

`engines.vscode` and `@types/vscode` say the same thing — the oldest editor
this extension supports — so they move together and neither follows the
latest release. At `^1.90.0` the extension installs on anything from June
2024 onwards; raise both, deliberately, when something here needs a newer
API.
