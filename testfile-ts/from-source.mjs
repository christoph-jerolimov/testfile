// Run the packages straight from src/, without building them first.
//
//   node --import ./testfile-ts/from-source.mjs --test "testfile-ts/*/src/**/*.test.ts"
//
// Node itself runs TypeScript since 22.18: it strips the types and runs what
// is left. Three things it does not do, and this fills them in:
//
//   - `./loader.js` is how a TypeScript file imports its neighbour, and Node
//     looks for exactly that file. Where it does not exist and `./loader.ts`
//     does, that is what was meant.
//   - `@testfile.dev/core` resolves through node_modules to the package's
//     `exports`, which point at dist/. From source it should be src/.
//   - `.tsx` is not a file extension Node knows. The TUI is written in it, so
//     those go through esbuild - the only part of this that is not the
//     platform doing the work.
//
// Types are stripped, not checked - `npm run build` is still what says the
// code compiles, and CI runs the built tests. This is for the edit-run loop.
import { existsSync, readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { transformSync } from "esbuild";

const packages = join(dirname(fileURLToPath(import.meta.url)));
const SCOPE = "@testfile.dev/";

// The file a specifier meant, when the one it named is not there.
function sourceFor(specifier, parentURL) {
  if (specifier.startsWith(SCOPE)) {
    const [name, subpath = "index"] = specifier.slice(SCOPE.length).split("/");
    const file = join(packages, name, "src", `${subpath}.ts`);
    return existsSync(file) ? pathToFileURL(file).href : undefined;
  }
  if (!parentURL?.startsWith("file:") || !/^\.{1,2}\//.test(specifier)) return undefined;
  if (!specifier.endsWith(".js")) return undefined;
  const asked = new URL(specifier, parentURL);
  if (existsSync(fileURLToPath(asked))) return undefined;
  for (const extension of [".ts", ".tsx"]) {
    const candidate = new URL(specifier.slice(0, -3) + extension, parentURL);
    if (existsSync(fileURLToPath(candidate))) return candidate.href;
  }
  return undefined;
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    const url = sourceFor(specifier, context.parentURL);
    // no `format`: Node reads it off the extension, and only then strips types
    return url ? { url, shortCircuit: true } : nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (!url.endsWith(".tsx")) return nextLoad(url, context);
    const { code } = transformSync(readFileSync(fileURLToPath(url), "utf8"), {
      loader: "tsx",
      format: "esm",
      // matching tui/tsconfig.json, so the components import their own runtime
      jsx: "automatic",
      sourcefile: fileURLToPath(url),
      sourcemap: "inline",
    });
    return { format: "module", source: code, shortCircuit: true };
  },
});
