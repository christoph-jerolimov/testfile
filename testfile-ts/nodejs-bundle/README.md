# @testfile.dev/nodejs-bundle

**Experimental.** The `testfile` CLI as one file you can copy onto a machine
that has no node, no npm and no `node_modules` — built by node itself, with
[single executable applications](https://nodejs.org/api/single-executable-applications.html).

```sh
npm run bundle --workspace @testfile.dev/nodejs-bundle   # needs node >= 25.5
./dist/testfile --version
```

`prebundle` builds the CLI and bundles it to a single script first
([`../cli/bundle.mjs`](../cli/bundle.mjs)); this package only turns that
script into a binary. Nothing here runs in this repository's CI — which
still builds and tests on node 22 — and that is what "experimental" means.

## What came out

Measured on Linux x64 with node 25.9.0, against the CLI at 0.1.0:

| | |
| ---------------- | ------ |
| binary | **126 MB** |
| bundled script in | 2.9 MB |
| `--version`, `validate`, `start` | all work on a real Testfile |
| `tui` | renders — Ink and React are in the binary |

## Why this needs node 25

Two things landed in **25.5.0**, and this package needs both.

**`--build-sea`.** Before it, making a single executable was a four-step
dance: write a config, run `--experimental-sea-config` to get a *preparation
blob*, copy the node binary yourself, then inject the blob into the copy with
[postject](https://github.com/nodejs/postject) — plus `codesign`/`signtool`
on macOS and Windows. Now the config's `output` is the executable, and node
does the rest:

```sh
node --build-sea=sea-config.json
```

On anything older there is no gentle degradation, just:

```
node: bad option: --build-sea=sea-config.json
```

**`"mainFormat": "module"`.** SEA treats the injected main as CommonJS
unless told otherwise, and that is not a setting this CLI can live with: it
ends in `await program.parseAsync(...)`, and yoga-layout has its own
top-level await, so there is no CommonJS build to inject in the first place
(esbuild reports five *"Top-level await is currently not supported"*
errors). Without the field, the binary builds and then refuses its own
payload at startup:

```
Warning: Failed to load the ES module: testfile.bundle.mjs.
Make sure to set "type": "module" in the nearest package.json ...
import { createRequire as __cr } from "node:module";
^^^^^^
```

There is no `package.json` inside the executable to set it in — the config
field is the answer. It cannot be combined with `"useSnapshot"`, which is
why that one is not set here.

## The config

[`sea-config.json`](sea-config.json) is four lines, and every one of them
matters:

| field | |
| --- | --- |
| `main` | the bundled script — one self-contained file, because SEA embeds exactly one |
| `mainFormat` | `"module"`, see above |
| `output` | the executable, not a blob — that is what `--build-sea` changed |
| `disableExperimentalSEAWarning` | SEA is stability 1.1; without this every run prints a warning to stderr, which would end up in the middle of test output |
