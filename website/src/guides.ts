// The guide pages pair a markdown guide from docs/guides/ with the real
// Testfile from the repository's examples/ folder (validated against the
// schema in CI), so a page can never drift from the file it shows. The files
// are pulled in at build time and resolved against *this* module - reading
// them from disk at render time would depend on where the compiled page ends
// up.
import type { CollectionEntry } from "astro:content";

const testfiles = import.meta.glob("../../examples/*/Testfile", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

// The Testfile of each example as published: the editor's schema hint is an
// instruction to the language server, not part of the example. Keyed by the
// directory name under examples/, which is also the guide's route name.
export const guideTestfiles: Record<string, string> = Object.fromEntries(
  Object.entries(testfiles).map(([path, source]) => [
    path.split("/").at(-2)!,
    source.replace(/^# yaml-language-server:.*\n/, ""),
  ]),
);

// Guides live in the docs collection (they are rendered from docs/guides/),
// but they have their own routes and their own menu - these two helpers keep
// the split in one place.
export function isGuide(doc: CollectionEntry<"docs">): boolean {
  return doc.id.startsWith("guides/");
}

// "guides/pytest-postgres" -> "pytest-postgres", the route under /guides/.
export function guideSlug(doc: CollectionEntry<"docs">): string {
  return doc.id.replace(/^guides\//, "");
}

export const examplesRepoUrl = "https://github.com/testfile-dev/testfile/blob/main/examples";
