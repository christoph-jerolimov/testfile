// The whole CLI as one file: dist/testfile.bundle.mjs.
//
// Nothing here is needed to *run* testfile - `dist/cli.js` plus node_modules
// is the normal way. This exists because the single-binary packagers in
// ../deno-bundle, ../bun-bundle and ../nodejs-bundle all want one
// self-contained script, and each of them resolving a monorepo's
// node_modules on its own goes differently (and, in deno's case, embeds
// every workspace in the repository - 471 MB of binary).
//
// Three things need saying to esbuild, and they are the reason this is a
// script and not a one-line npm script:
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

const stub = fileURLToPath(new URL("bundle-stub.mjs", import.meta.url));

await build({
  entryPoints: ["dist/cli.js"],
  outfile: "dist/testfile.bundle.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
  // 1. The output is ESM, and some dependencies (yaml) are CommonJS. esbuild
  //    wraps their `require` in a shim that throws unless a real `require`
  //    is in scope - so one is put there.
  banner: {
    js: 'import { createRequire as __cr } from "node:module";\nconst require = __cr(import.meta.url);',
  },
  // 2. Ink reaches for react-devtools-core when DEV=true, and only then. The
  //    package is not installed, and marking it external does not help: a
  //    compiled binary resolves its externals at startup and dies before it
  //    prints anything. An empty module satisfies the import that never runs.
  alias: { "react-devtools-core": stub },
  logLevel: "warning",
});

// esbuild keeps the entry's shebang above the banner, so the result is not
// only something the packagers read: `node dist/testfile.bundle.mjs` runs the
// whole CLI. That is how you tell a bundling problem from a packaging one.
