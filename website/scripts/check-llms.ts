// llms.txt is an index for models: every page of the site, one line each.
// An index that silently misses a page is worse than none - a model that
// reads it believes it has seen everything - so this checks the built
// files against the pages the build produced.
//
// Run over dist/ after a build, like the link checker next to it. A command,
// not a module: its tests run it the way CI does. See check-llms.test.ts.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Every route the build produced, as "/docs/cli"-style paths. Only pages
// count: assets and the plain-text files themselves are not indexable.
function pagesOf(dir: string, prefix = ""): string[] {
  const pages: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      pages.push(...pagesOf(path, `${prefix}/${entry.name}`));
    } else if (entry.name === "index.html") {
      pages.push(prefix === "" ? "/" : prefix);
    }
  }
  return pages.sort();
}

// The site's own pages among the links. Matched against the full site URL,
// not just a path: with the site served at the domain root, every pathname
// would look like a page, yet a repository link like
// github.com/someone/testfile is not a page of this site.
function linkedPaths(llms: string, site: string): Set<string> {
  const found = new Set<string>();
  const basePath = new URL(site).pathname.replace(/\/$/, "");
  for (const match of llms.matchAll(/\]\((https?:\/\/[^)\s]+)\)/g)) {
    const url = match[1];
    if (url !== site && !url.startsWith(`${site}/`)) continue;
    found.add(new URL(url).pathname.slice(basePath.length) || "/");
  }
  return found;
}

// Pages an index may leave out, and why.
const NOT_INDEXED = new Set(["/"]);

function checkLlms(dir: string, { site }: { site: string }): string[] {
  const problems: string[] = [];
  let index: string;
  try {
    index = readFileSync(join(dir, "llms.txt"), "utf8");
  } catch {
    return ["llms.txt was not built"];
  }

  // The format: a title, a blockquote summary, then link lists.
  if (!/^# \S/m.test(index)) problems.push("llms.txt: no title heading");
  if (!/^> /m.test(index)) problems.push("llms.txt: no summary blockquote");

  const linked = linkedPaths(index, site);
  for (const page of pagesOf(dir)) {
    if (NOT_INDEXED.has(page)) continue;
    if (!linked.has(page)) problems.push(`llms.txt: ${page} is built but not indexed`);
  }

  let full: string;
  try {
    full = readFileSync(join(dir, "llms-full.txt"), "utf8");
  } catch {
    problems.push("llms-full.txt was not built");
    return problems;
  }
  // Every indexed page should also be quoted in the full text, so the two
  // files describe the same site.
  for (const page of linked) {
    if (page.endsWith(".txt")) continue;
    if (!full.includes(`${site}${page}`)) {
      problems.push(`llms-full.txt: ${page} is indexed but its text is missing`);
    }
  }
  return problems;
}

// node out/check-llms.js dist https://christoph-jerolimov.github.io
const [dir = "dist", site = "https://christoph-jerolimov.github.io"] = process.argv.slice(2);
const problems = checkLlms(dir, { site });
for (const problem of problems) console.error(problem);
if (problems.length > 0) process.exit(1);
console.log(`llms.txt indexes every page of ${dir}`);
