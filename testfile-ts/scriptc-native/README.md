# @testfile/scriptc-native

**Experimental.** `testfile-report`: a **419 KB** binary with **no JavaScript
engine in it**, compiled from TypeScript by
[scriptc](https://scriptc.dev) ([vercel-labs/scriptc](https://github.com/vercel-labs/scriptc)).

```sh
npm run build --workspace @testfile/scriptc-native

testfile start --reporter json --output run.json
./dist/testfile-report run.json
# 20260817-224439-f86a  passed  (3 passed, 0 failed, 0 other)
```

It prints the verdict, lists the tests that failed, and exits non-zero when
the run did — so a pipeline step can *be* this binary. That is a small job,
and the point is what it costs: it drops into a scratch container or a release
image where installing node to read a JSON file would be the largest thing in
the layer.

## How this differs from the other three

The [deno](../deno-bundle/), [bun](../bun-bundle/) and [nodejs](../nodejs-bundle/)
packages embed the script into a copy of a **runtime**. Their binaries are
native executables, but the JavaScript inside is still parsed and JIT-compiled
at startup — which is why they weigh ~100 MB for a 2.9 MB program, and why a
source string greps straight out of them.

scriptc compiles the TypeScript itself, through LLVM, to machine code.

| | what it embeds | size |
| --- | --- | --- |
| bun / deno / node | the whole runtime + your script | 98 / 103 / 126 MB |
| **scriptc** | **nothing — compiled code** | **419 KB** |

`ldd` on the result lists `libm` and `libc`, nothing else. No V8, no
JavaScriptCore, no engine strings anywhere in the file.

## Why this is `testfile-report` and not `testfile`

**The full CLI does not compile.** `scriptc coverage` over the bundled CLI:

```
not analyzable: 200 TypeScript errors — fix type errors first
  (scriptc only analyzes programs that typecheck)
```

The errors are not ours — they come from the bundled React/Ink internals
reaching for browser globals (`reportError`, `window`) that do not exist in a
compiled program. `yaml` does not compile either, even with `--npm-static`:

```
node_modules/yaml/dist/schema/yaml-1.1/set.js:7:23
  error SC1090: extending the namespace member 'YAMLMap' (no class lowering)
  is not supported yet
```

which rules out reading `run.yaml` directly and is why this reads the JSON
report instead. What does work, verified here: `node:fs` (`readFileSync`,
`readdirSync`, `existsSync`), `node:path`, `node:child_process`
(`spawnSync`), `JSON.parse`, template literals, `??`, and plain control flow.

## One semantic difference worth knowing

**scriptc bounds-checks arrays.** Reading past the end aborts rather than
returning `undefined`:

```
scriptc: RangeError: array index 2 out of bounds (length 2)
Aborted
```

The first version of this program did `process.argv[2]`, which is idiomatic
JavaScript and a crash here — running `testfile-report` with no argument
aborted instead of printing usage. It asks `process.argv.length` first now.
Worth carrying into anything else compiled this way: the language scriptc
accepts looks like TypeScript, but it is stricter than a JS engine at runtime.

## Not in CI

scriptc is at **0.0.32** and shells out to the system `clang`. The Linux leg
could probably run it; the macOS and Windows legs are a different question,
and the version number is what it is. Like the three packagers, this package
is not in the repository's [`Testfile`](../../Testfile) — build it by hand
when you want the binary.
