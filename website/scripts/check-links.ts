// Checks that the built site links to pages that exist.
//
// The documentation is written as markdown in docs/ and spec/, linked the way
// GitHub reads it, and a rehype plugin rewrites those links for the published
// site (src/markdown-links.ts). Renaming a page or a heading therefore breaks
// links in files nobody touched, and a static site has nothing that notices.
// This does: it reads the generated HTML in dist/ and resolves every internal
// href and src against it, anchors included.
//
// External links (http, mailto, the repository blob URLs the plugin writes)
// are not fetched - the check must work offline and stay fast.
//
// A command, not a module: its tests run it the way CI does. See
// scripts/check-links.test.ts.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, posix, relative } from "node:path";

// Every attribute that points at something the site must ship.
const LINK_ATTRIBUTES = /(?:href|src)="([^"]*)"/g;
const ID_ATTRIBUTES = /(?:id|name)="([^"]*)"/g;

// Links the markdown plugin points at the repository instead of the site.
// They are not fetched either - the file they name is looked up in the
// working copy, which catches a renamed or deleted repository file.
const REPO_BLOB_URL = "https://github.com/testfile-dev/testfile/blob/main/";

interface Options {
  base?: string;
  repoRoot?: string;
}

function htmlFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...htmlFiles(path));
    else if (entry.name.endsWith(".html")) out.push(path);
  }
  return out;
}

// The links of one page, as they are written in the HTML.
function linksOf(html: string): string[] {
  return [...html.matchAll(LINK_ATTRIBUTES)].map((match) => match[1]);
}

function idsOf(html: string): Set<string> {
  return new Set([...html.matchAll(ID_ATTRIBUTES)].map((match) => match[1]));
}

function isExternal(href: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("//");
}

// Where a site-absolute path lives in dist/: Astro writes /docs/cli/ as
// docs/cli/index.html, and a file link keeps its name.
function targetFile(dist: string, path: string): string | undefined {
  const clean = path.replace(/\/+$/, "");
  const candidates = clean
    ? [join(dist, clean), join(dist, `${clean}.html`), join(dist, clean, "index.html")]
    : [join(dist, "index.html")];
  for (const candidate of candidates) {
    try {
      if (statSync(candidate).isFile()) return candidate;
    } catch {
      // does not exist, try the next shape
    }
  }
  return undefined;
}

// Returns one message per broken link; an empty array means everything
// resolves. `repoRoot` enables the repository-file check above.
function checkLinks(dist: string, { base = "", repoRoot }: Options = {}): string[] {
  const problems: string[] = [];
  // paths in messages and in the resolution below are always "/"-separated,
  // including on Windows
  const inDist = (file: string): string => relative(dist, file).split("\\").join("/");
  const idCache = new Map<string, Set<string>>();
  const idsFor = (file: string, html?: string): Set<string> => {
    let ids = idCache.get(file);
    if (!ids) {
      ids = idsOf(html ?? readFileSync(file, "utf8"));
      idCache.set(file, ids);
    }
    return ids;
  };

  for (const file of htmlFiles(dist).sort()) {
    const html = readFileSync(file, "utf8");
    idsFor(file, html);
    const page = `/${inDist(file)}`;
    for (const href of linksOf(html)) {
      if (!href) continue;
      if (repoRoot && href.startsWith(REPO_BLOB_URL)) {
        const inRepo = decodeURI(href.slice(REPO_BLOB_URL.length).split("#")[0]);
        try {
          statSync(join(repoRoot, inRepo));
        } catch {
          problems.push(`${page}: ${href} - no ${inRepo} in the repository`);
        }
        continue;
      }
      if (isExternal(href) || href.startsWith("data:")) continue;
      const [rawPath, ...rest] = href.split("#");
      const anchor = rest.join("#");
      let target = file;
      if (rawPath) {
        // links in the built pages are site-absolute and carry the base
        let path = decodeURI(rawPath);
        if (base && (path === base || path.startsWith(`${base}/`))) path = path.slice(base.length);
        else if (!path.startsWith("/")) path = posix.resolve(posix.dirname(page), path);
        const found = targetFile(dist, path);
        if (!found) {
          problems.push(`${page}: ${href} - no such page in dist/`);
          continue;
        }
        target = found;
      }
      if (anchor && !idsFor(target).has(decodeURIComponent(anchor))) {
        problems.push(`${page}: ${href} - ${inDist(target)} has no "${anchor}" anchor`);
      }
    }
  }
  return problems;
}

// node out/check-links.js dist "" ..
const dist = process.argv[2] ?? "dist";
// the site is served at the domain root, so there is no base to strip
const base = process.argv[3] ?? "";
let pages: number;
try {
  pages = htmlFiles(dist).length;
} catch {
  console.error(`no built site in ${dist} - run "npm run build --workspace website" first`);
  process.exit(1);
}
const problems = checkLinks(dist, { base, repoRoot: process.argv[4] ?? ".." });
for (const problem of problems) console.error(`broken link ${problem}`);
if (problems.length > 0) {
  console.error(`\n${problems.length} broken link(s) in ${pages} page(s)`);
  process.exit(1);
}
console.log(`all links in ${pages} page(s) resolve`);
