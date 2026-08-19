// The documentation menu is split into these groups, in this order. Every
// docs page names its group in the `category` frontmatter field and sorts
// within the group by `order`; a page with an unknown (or missing) category
// still renders, in a trailing "Documentation" group, so a typo cannot make
// a page disappear from the menu.
import type { CollectionEntry } from "astro:content";

export const docsCategories = ["Quick start", "Test definition", "Run tests", "Review results"];

// The trailing group for pages no category claims.
export const fallbackCategory = "Documentation";

export function categoryOf(doc: CollectionEntry<"docs">): string {
  const category = doc.data.category ?? "";
  return docsCategories.includes(category) ? category : fallbackCategory;
}

// Menu order: by group, then by the page's order within it.
export function compareDocs(a: CollectionEntry<"docs">, b: CollectionEntry<"docs">): number {
  const rank = (doc: CollectionEntry<"docs">) => {
    const index = docsCategories.indexOf(categoryOf(doc));
    return index === -1 ? docsCategories.length : index;
  };
  return rank(a) - rank(b) || a.data.order - b.data.order;
}
