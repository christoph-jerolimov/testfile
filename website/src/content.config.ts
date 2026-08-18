import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";

// The website has no content of its own: it renders the markdown files from
// the repository's docs/ folder.
const docs = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "../docs" }),
  schema: z.object({
    title: z.string(),
    order: z.number().default(999),
    description: z.string().optional(),
  }),
});

// ... the blog posts from blog/, addressed by file name and listed
// newest first ...
const blog = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "../blog" }),
  schema: z.object({
    title: z.string(),
    date: z.coerce.date(),
    description: z.string(),
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

export const collections = { docs, blog, spec };
