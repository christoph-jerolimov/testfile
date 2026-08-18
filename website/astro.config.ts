// @ts-check
import { unified } from "@astrojs/markdown-remark";
import { defineConfig } from "astro/config";
import { rewriteMarkdownLinks } from "./src/markdown-links";

// Published on GitHub Pages at the domain root, so links carry no base
// path. Astro's own `base` stays at its default ("/"); the empty string
// here is what the link-rewriting plugin prefixes site paths with.
const base = "";

export default defineConfig({
  site: "https://testfile.dev",
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
