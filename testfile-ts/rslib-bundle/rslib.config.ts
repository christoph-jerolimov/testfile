// The CLI as one file, built by Rslib (Rspack underneath) instead of esbuild.
//
// ../cli/bundle.mjs does the same job in a dozen lines of esbuild. This is the
// second opinion: a different bundler over the same input, producing a script
// the same three packagers can turn into a binary. Where the two disagree, one
// of them is wrong about our dependency graph - worth knowing before a
// packager turns the disagreement into a broken binary.
import { defineConfig } from "@rslib/core";
import { rspack } from "@rspack/core";
import { fileURLToPath } from "node:url";

const stub = fileURLToPath(new URL("../cli/bundle-stub.mjs", import.meta.url));

export default defineConfig({
  lib: [{ format: "esm", bundle: true, syntax: "es2022" }],
  source: {
    entry: { testfile: "../cli/dist/cli.js" },
  },
  output: {
    target: "node",
    distPath: { root: "dist" },
    // readable, like the esbuild bundle: what a packager embeds should be
    // something you can open when a binary misbehaves
    minify: false,
  },
  tools: {
    // Mutated in place, not returned: a returned object *replaces* the config
    // Rslib built, entry and all ("Could not find any entry module").
    rspack: (config, { appendPlugins }) => {
      // ink reaches for react-devtools-core only when DEV=true, the package is
      // not installed, and an external would be resolved at *startup* by a
      // compiled binary and kill it. Same stub as the esbuild build.
      config.resolve ??= {};
      config.resolve.alias = { ...config.resolve.alias, "react-devtools-core": stub };

      // And ink's own devtools module, which esbuild never has to think about.
      // With asyncChunks off (below), Rspack evaluates the target of ink's
      // `await import("./devtools.js")` when the bundle initialises rather than
      // when the import runs - and that module's body ends in a top-level await
      // and a console.warn. Every command printed "DEV is set to true, but the
      // React DevTools server is not running" to stderr, with DEV unset.
      //
      // resolve.alias cannot catch this: aliases match the request string
      // ("./devtools.js"), not the file it resolves to. This matches the path.
      appendPlugins(
        new rspack.NormalModuleReplacementPlugin(/ink[\\/]build[\\/]devtools\.js$/, stub),
      );

      // One file, which is the whole point. Left to itself Rspack splits this
      // into six - a runtime, two vendor chunks and a chunk per dynamic import
      // (the CLI has one: `await import("@testfile/tui")`). A packager embeds a
      // script, not a folder, so both kinds of splitting are off.
      config.optimization = { ...config.optimization, splitChunks: false };
      config.output = { ...config.output, asyncChunks: false };
    },
  },
});
