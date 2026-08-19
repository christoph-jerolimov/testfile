import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";

// The website has almost no content of its own: it renders the markdown
// files from the repository's docs/ folder. That includes docs/guides/,
// whose pages are published under /guides/ with their own menu - see
// src/guides.ts for the split. Each guide is a folder: an index.mdx next to
// the example files it embeds, so the folder's README and the ids drop the
// "/index" suffix.
const docs = defineCollection({
  loader: glob({
    pattern: ["**/*.md", "**/*.mdx", "!**/README.md"],
    base: "../docs",
    generateId: ({ entry }) => entry.replace(/\.mdx?$/, "").replace(/\/index$/, ""),
  }),
  schema: z.object({
    title: z.string(),
    order: z.number().default(999),
    description: z.string().optional(),
    // Guides only: the language or ecosystem the example is written for.
    stack: z.string().optional(),
  }),
});

// ... and the normative documents from spec/, published verbatim. They have
// no frontmatter, so the id stays the file name (README, RESULTS,
// VERSIONING) and the titles live in src/spec.ts.
const spec = defineCollection({
  loader: glob({
    pattern: "*.md",
    base: "../spec",
    generateId: ({ entry }) => entry.replace(/\.md$/, ""),
  }),
});

// The blog is the one thing written for the website itself rather than for
// the repository, so its posts live here and not in docs/.
const blog = defineCollection({
  loader: glob({ pattern: "*.md", base: "./src/content/blog" }),
  schema: z.object({
    title: z.string(),
    date: z.coerce.date(),
    description: z.string(),
  }),
});

export const collections = { docs, spec, blog };
