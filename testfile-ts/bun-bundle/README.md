# @testfile.dev/bun-bundle

**Experimental.** The `testfile` CLI as one file you can copy onto a machine
that has no node, no npm and no `node_modules`, built with
[`bun build --compile`](https://bun.com/docs/bundler/executables).

```sh
npm run bundle --workspace @testfile.dev/bun-bundle
./dist/testfile --version
```

`prebundle` builds the CLI and bundles it to a single script first
([`../cli/bundle.mjs`](../cli/bundle.mjs)); this package only turns that
script into a binary. Bun is not installed for you — get it from
[bun.com](https://bun.com/) — and nothing here runs in this repository's CI,
which is what "experimental" means.

## What came out

Measured on Linux x64 with bun 1.3.11, against the CLI at 0.1.0:

| | |
| ---------------- | ------ |
| binary | **98 MB** — the smallest of the three |
| bundled script in | 2.9 MB |
| compile time | ~250 ms, and it is the whole command |
| `--version`, `validate`, `start` | all work on a real Testfile |
| `tui` | renders — Ink and React are in the binary |

No flags. Deno needs three and node needs a config file; `bun build
--compile` reads the script and writes an executable.

## Why the pre-bundled script, when bun bundles by itself

`bun build --compile` on `dist/cli.js` works too — bun resolves the
workspace without complaint, which deno could not — but it stops on the same
thing that stops esbuild:

```
error: Could not resolve: "react-devtools-core". Maybe you need to "bun install"?
    at node_modules/ink/build/devtools.js:7:22
```

Ink imports that package only when `DEV=true`, and it is not installed here.
`--external react-devtools-core` is the obvious answer and it is wrong — the
build then succeeds and the *binary* fails, before printing anything at all:

```
error: Cannot find package 'react-devtools-core' from '/$bunfs/root/testfile'
```

A compiled binary resolves its externals at startup, so "external" means
"must exist on the target machine". The shared bundling step aliases the
package to an empty module instead, which satisfies an import that never
runs — and then bun has one file with nothing left to resolve.
