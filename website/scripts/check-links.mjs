// Checks that the built site links to pages that exist.
//
// The documentation is written as markdown in docs/ and spec/, linked the way
// GitHub reads it, and a rehype plugin rewrites those links for the published
// site (src/markdown-links.mjs). Renaming a page or a heading therefore breaks
// links in files nobody touched, and a static site has nothing that notices.
// This does: it reads the generated HTML in dist/ and resolves every internal
// href and src against it, anchors included.
//
// External links (http, mailto, the repository blob URLs the plugin writes)
// are not fetched - the check must work offline and stay fast.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, posix, relative } from "node:path";
import { pathToFileURL } from "node:url";

// Every attribute that points at something the site must ship.
const LINK_ATTRIBUTES = /(?:href|src)="([^"]*)"/g;
const ID_ATTRIBUTES = /(?:id|name)="([^"]*)"/g;

export function htmlFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...htmlFiles(path));
    else if (entry.name.endsWith(".html")) out.push(path);
  }
  return out;
}

// The links of one page, as they are written in the HTML.
export function linksOf(html) {
  return [...html.matchAll(LINK_ATTRIBUTES)].map((match) => match[1]);
}

export function idsOf(html) {
  return new Set([...html.matchAll(ID_ATTRIBUTES)].map((match) => match[1]));
}

function isExternal(href) {
  return /^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("//");
}

// Where a site-absolute path lives in dist/: Astro writes /docs/cli/ as
// docs/cli/index.html, and a file link keeps its name.
function targetFile(dist, path) {
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

// Links the markdown plugin points at the repository instead of the site.
// They are not fetched either - the file they name is looked up in the
// working copy, which catches a renamed or deleted repository file.
export const REPO_BLOB_URL = "https://github.com/christoph-jerolimov/testfile/blob/main/";

// Returns one message per broken link; an empty array means everything
// resolves. `repoRoot` enables the repository-file check above.
export function checkLinks(dist, { base = "", repoRoot } = {}) {
  const problems = [];
  const idCache = new Map();
  const idsFor = (file, html) => {
    if (!idCache.has(file)) idCache.set(file, idsOf(html ?? readFileSync(file, "utf8")));
    return idCache.get(file);
  };

  for (const file of htmlFiles(dist).sort()) {
    const html = readFileSync(file, "utf8");
    idsFor(file, html);
    const page = `/${relative(dist, file).split("\\").join("/")}`;
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
        problems.push(`${page}: ${href} - ${relative(dist, target)} has no "${anchor}" anchor`);
      }
    }
  }
  return problems;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dist = process.argv[2] ?? "dist";
  const base = process.argv[3] ?? "/testfile";
  let pages;
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
}
