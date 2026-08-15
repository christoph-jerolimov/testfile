import { defineConfig } from "vite";

// `testfile serve` mounts the viewer at the root and falls back to
// index.html for anything it does not have, so that a URL like
// /runs/20260101-120000-fx01 can be opened directly. Asset URLs therefore
// have to be absolute: a relative base would make that page ask for
// /runs/assets/... and get the HTML shell back in place of its own script.
//
// No React plugin: the JSX transform comes from tsconfig.json's
// `"jsx": "react-jsx"`, which Vite reads. The plugin buys Fast Refresh in
// `vite dev`, which this project does not depend on.
export default defineConfig({
  base: "/",
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: true,
  },
});
