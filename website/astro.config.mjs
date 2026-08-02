// @ts-check
import { defineConfig } from "astro/config";

// Published on GitHub Pages under /<repo>/.
export default defineConfig({
  site: "https://christoph-jerolimov.github.io",
  base: "/testfile",
  markdown: {
    shikiConfig: {
      themes: { light: "github-light", dark: "github-dark" },
    },
  },
});
