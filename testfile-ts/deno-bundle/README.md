# @testfile/deno-bundle

**Experimental.** The `testfile` CLI as one file you can copy onto a machine
that has no node, no npm and no `node_modules`, built with
[`deno compile`](https://docs.deno.com/runtime/reference/cli/compile/).

```sh
npm run bundle --workspace @testfile/deno-bundle
./dist/testfile --version
```

`prebundle` builds the CLI and bundles it to a single script first
([`../cli/bundle.mjs`](../cli/bundle.mjs)); this package only turns that
script into a binary. Deno is not installed for you — get it from
[deno.com](https://deno.com/) — and nothing here runs in this repository's
CI, which is what "experimental" means.

## What came out

Measured on Linux x64 with deno 2.9.5, against the CLI at 0.1.0:

| | |
| ---------------- | ------ |
| binary | **103 MB** |
| bundled script in | 2.9 MB |
| runs a real suite | yes — `testfile start` and `testfile validate` on a real Testfile |

## The three flags, and why

**`--allow-all`.** Deno's permissions are decided when the binary is
compiled, not when it runs, and a test runner is the awkward case for them: it
starts processes the Testfile names, reads and writes the run folder, opens
sockets for readiness checks, and reaches for a container engine. That is
approximately all of them, so narrowing the set would mean guessing what
suites are allowed to do. A binary that refuses to run half the Testfiles it
is handed is worse than one that inherits the trust you already gave the CLI.

**`--no-check`.** The input is JavaScript that `tsc` already type-checked
during `npm run build`. Left on, deno type-checks the whole graph again with
its own resolver, and disagrees with `tsc` about one line in the TUI's
generated types:

```
TS2305 [ERROR]: Module '.../tui/dist/app.js' has no exported member 'ViewerView'
    at .../tui/dist/index.d.ts:2:15
```

`app.d.ts` does export it. Two checkers, two answers about a type re-export
through a `.js` specifier — and neither answer changes the binary, since
types are gone by then.

**`--node-modules-dir=none`.** Without it, deno notices it is standing in an
npm workspace and embeds the members — `viewer-web`, `website`,
`vscode-extension`, all of it — into a binary that imports none of them:

```
Files: 374.92MB
-rwxr-xr-x 475M dist/testfile
```

The input is one self-contained file with nothing left to resolve, so there
is nothing for a `node_modules` to contribute. Saying so costs 372 MB.

## Why it is not `deno compile` on `dist/cli.js`

That was the first thing tried. Deno resolves npm dependencies itself, and
pointed straight at the CLI it hit the workspace problem above *and* a
resolution it could not finish:

```
error: Could not find constraint '@testfile/sync@^0.1.0' in the list of packages.
```

471 MB, and still no binary. Bundling to a single script first sidesteps the
resolver entirely: deno gets one file with no imports to follow.
