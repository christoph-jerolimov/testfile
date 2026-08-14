// @ts-check
import { unified } from "@astrojs/markdown-remark";
import { defineConfig } from "astro/config";
import { rewriteMarkdownLinks } from "./src/markdown-links";

// Published on GitHub Pages under /<repo>/.
const base = "/testfile";

export default defineConfig({
  site: "https://christoph-jerolimov.github.io",
  base,
  markdown: {
    // The remark/rehype pipeline, not Astro's newer default processor: the
    // link rewriting below is a rehype plugin, and the heading ids this
    // produces are what the documentation links to.
    // The docs/ and spec/ markdown links point at repository paths, see the plugin.
    processor: unified({ rehypePlugins: [[rewriteMarkdownLinks, { base }]] }),
    shikiConfig: {
      themes: { light: "github-light", dark: "github-dark" },
    },
  },
});
