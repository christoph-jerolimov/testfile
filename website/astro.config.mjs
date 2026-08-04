// @ts-check
import { defineConfig } from "astro/config";
import { rewriteMarkdownLinks } from "./src/markdown-links.mjs";

// Published on GitHub Pages under /<repo>/.
const base = "/testfile";

export default defineConfig({
  site: "https://christoph-jerolimov.github.io",
  base,
  markdown: {
    // the docs/ and spec/ markdown links point at repository paths, see the plugin
    rehypePlugins: [[rewriteMarkdownLinks, { base }]],
    shikiConfig: {
      themes: { light: "github-light", dark: "github-dark" },
    },
  },
});
