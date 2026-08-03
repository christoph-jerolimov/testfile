import type { RunTest } from "./runsuite.js";

// Tag inventory over the full expanded suite (includes are merged at load
// time, matrix tests are expanded): every tag that appears anywhere, in
// which order it first appears, and how many runnable tests carry it -
// directly or inherited from an ancestor, matching how `-t` filters.

export interface TagInfo {
  name: string;
  // How many leaf tests (command/script, incl. matrix instances) carry the
  // tag, own or inherited.
  count: number;
  // 0-based first-appearance index in document order.
  appearance: number;
}

export interface TagSummary {
  tags: TagInfo[];
  // Leaf tests without any tag, own or inherited.
  untagged: number;
  // All leaf tests.
  tests: number;
}

export function collectTags(suite: RunTest): TagSummary {
  const counts = new Map<string, number>();
  const order = new Map<string, number>();
  let untagged = 0;
  let tests = 0;

  const visit = (test: RunTest, inherited: ReadonlySet<string>): void => {
    const own = test.def.tags ?? [];
    for (const tag of own) {
      if (!order.has(tag)) order.set(tag, order.size);
    }
    const effective = own.length > 0 ? new Set([...inherited, ...own]) : inherited;
    if (test.children.length === 0) {
      tests++;
      if (effective.size === 0) untagged++;
      for (const tag of effective) counts.set(tag, (counts.get(tag) ?? 0) + 1);
      return;
    }
    for (const child of test.children) visit(child, effective);
  };
  visit(suite, new Set());

  return {
    tags: [...order.entries()].map(([name, appearance]) => ({
      name,
      appearance,
      count: counts.get(name) ?? 0,
    })),
    untagged,
    tests,
  };
}

export type TagOrder = "alpha" | "appearance" | "count";

export function sortTags(tags: readonly TagInfo[], order: TagOrder): TagInfo[] {
  const sorted = [...tags];
  switch (order) {
    case "alpha":
      sorted.sort((a, b) => a.name.localeCompare(b.name));
      break;
    case "appearance":
      sorted.sort((a, b) => a.appearance - b.appearance);
      break;
    case "count":
      sorted.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
      break;
  }
  return sorted;
}
