// Bundles the viewer into dist/: one JS file, the stylesheet and the HTML
// shell. `testfile serve` picks dist/ up automatically in the monorepo.
import { build } from "esbuild";
import { copyFileSync, mkdirSync } from "node:fs";

mkdirSync("dist", { recursive: true });
await build({
  entryPoints: ["src/main.tsx"],
  bundle: true,
  minify: true,
  sourcemap: true,
  outfile: "dist/app.js",
  jsx: "automatic",
  define: { "process.env.NODE_ENV": '"production"' },
  logLevel: "info",
});
copyFileSync("src/index.html", "dist/index.html");
copyFileSync("src/style.css", "dist/style.css");
