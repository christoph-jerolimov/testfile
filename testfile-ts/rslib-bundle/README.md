# @testfile/rslib-bundle

**Experimental.** The `testfile` CLI bundled into one file by
[Rslib](https://rslib.rs/) — [Rspack](https://rspack.rs/) underneath — as a
second opinion on [`../cli/bundle.mjs`](../cli/bundle.mjs), which does the
same job with esbuild.

```sh
npm run bundle --workspace @testfile/rslib-bundle
node dist/testfile.js --version
```

The output is interchangeable with the esbuild one: the three packagers
([deno](../deno-bundle/), [bun](../bun-bundle/), [nodejs](../nodejs-bundle/))
take either. `bun build --compile` over this bundle produces a 98 MB binary
that runs a real suite, same as over esbuild's.

## Why a second bundler at all

Because the packagers only ever see the bundler's answer. If esbuild is wrong
about our dependency graph — a dynamic import it resolves differently, a
CommonJS dependency it wraps differently — the first symptom is a binary that
misbehaves, long after the bundling step that caused it. Two bundlers over the
same input disagreeing is a cheap way to find that out early.

It found something immediately. See below.

## What came out

Measured on Linux x64 with Rslib 0.23.2 / Rspack 2.1.10, against the CLI at 0.1.0:

| | esbuild | Rslib |
| --- | --- | --- |
| output | 2.9 MB, one file | **3.17 MB**, one file |
| build | ~0.3 s | ~0.15 s |
| runs `start`, `validate`, `--version` | yes | yes |
| `bun --compile` of the result | 98 MB, works | 98 MB, works |

## The three things Rspack needed that esbuild did not

**Splitting off, twice.** Left alone Rspack emits **six** files — a runtime,
two vendor chunks, and a chunk per dynamic import. A packager embeds a script,
not a folder, so `optimization.splitChunks` and `output.asyncChunks` are both
off.

**A replacement for ink's `devtools.js`, not just an alias.** With async chunks
off, Rspack evaluates the target of ink's `await import("./devtools.js")` when
the bundle *initialises* rather than when the import runs — and that module's
body ends in a top-level await and a `console.warn`. Every command printed

```
DEV is set to true, but the React DevTools server is not running.
```

to stderr, with `DEV` unset, in a CLI whose stderr is test output. esbuild
keeps the import lazy and never reaches it. `resolve.alias` cannot fix it
either: aliases match the request string (`"./devtools.js"`), not the file it
resolves to — hence `NormalModuleReplacementPlugin` against the resolved path.

**Mutate the config, don't return one.** `tools.rspack` as a returned object
*replaces* what Rslib built, entry included:

```
error [rsbuild:config] Could not find any entry module, please make sure that
src/index.(ts|js|tsx|jsx|mts|cts|mjs|cjs) exists
```

The function form mutates `config` in place and returns nothing.

## In CI

Unlike its three packager neighbours, this one **is** checked by the
repository's [`Testfile`](../../Testfile): it needs no toolchain beyond npm,
so the `rslib-bundle` test builds the bundle and runs the result. The others
need deno, bun or node 25 and stay out.

That test runs `npx rslib build`, not `npm run bundle`. The `prebundle` script
here rebuilds `@testfile/cli` for convenience, and that build begins by
deleting `../cli/dist` — fine in a terminal, fatal in a suite where `skills`
and `examples` are running `cli/dist/cli.js` in parallel. In CI the CLI is
already built, by `needs: [build-cli]`.
