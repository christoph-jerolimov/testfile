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

export const collections = { docs };
