// Bundles the extension into dist/extension.js (the `yaml` dependency is
// inlined; the vscode API stays external) and copies the JSON schema from
// the schema workspace so the packaged extension validates Testfiles and
// recorded run.yaml files
// standalone.
import { build } from "esbuild";
import { copyFileSync, mkdirSync } from "node:fs";

await build({
  entryPoints: ["src/extension.ts"],
  bundle: true,
  minify: true,
  platform: "node",
  format: "cjs",
  external: ["vscode"],
  outfile: "dist/extension.js",
  logLevel: "info",
});
mkdirSync("schemas", { recursive: true });
copyFileSync("../schema/testfile.schema.json", "schemas/testfile.schema.json");
copyFileSync("../schema/testrun.schema.json", "schemas/testrun.schema.json");
