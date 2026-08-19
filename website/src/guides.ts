// Each guide is a folder under docs/guides/: an index.mdx next to the real
// example files it embeds through the <Snippet> component
// (src/components/Snippet.tsx). The helpers here keep the split between the
// guides and the rest of the docs collection in one place, and pull in the
// guides' Testfiles for the llms-full.txt endpoint, which quotes them.
import type { CollectionEntry } from "astro:content";

const testfiles = import.meta.glob("../../docs/guides/*/Testfile", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

// The Testfile of each guide as published: the editor's schema hint is an
// instruction to the language server, not part of the example. Keyed by the
// folder name under docs/guides/, which is also the guide's route name.
export const guideTestfiles: Record<string, string> = Object.fromEntries(
  Object.entries(testfiles).map(([path, source]) => [
    path.split("/").at(-2)!,
    source.replace(/^# yaml-language-server:.*\n/, ""),
  ]),
);

// Guides live in the docs collection (they are rendered from docs/guides/),
// but they have their own routes and their own menu.
export function isGuide(doc: CollectionEntry<"docs">): boolean {
  return doc.id.startsWith("guides/");
}

// "guides/pytest-postgres" -> "pytest-postgres", the route under /guides/.
export function guideSlug(doc: CollectionEntry<"docs">): string {
  return doc.id.replace(/^guides\//, "");
}

export const guidesRepoUrl = "https://github.com/testfile-dev/testfile/tree/main/docs/guides";
