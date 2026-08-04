// The markdown files the website renders live in the repository and link
// each other the way GitHub reads them: docs/index.md points at
// "./getting-started", spec/README.md at "RESULTS.md" or at
// "../schema/testfile.schema.json". This plugin turns those relative links
// into links that work on the published site:
//
//   docs/*.md and the three spec documents -> the page here
//   anything else in the repository        -> the file on GitHub
//
// The result is always an absolute path, so it survives the trailing slash
// GitHub Pages adds to directory URLs - a relative "./cli" would otherwise
// resolve below the current page. Anchors, absolute URLs and links that are
// already rooted are left alone.
//
// A rehype plugin instead of a preprocessing step, so the markdown files stay
// the single source and nothing is copied into the website.

// where the spec documents are published, by repository path - kept in sync
// with src/spec.ts (which cannot be imported here: this runs in the Astro
// config, before the TypeScript pipeline).
const specPages = {
  "spec/README.md": "testfile",
  "spec/RESULTS.md": "test-result",
  "spec/VERSIONING.md": "versioning",
};

const repoBlobUrl = "https://github.com/christoph-jerolimov/testfile/blob/main";

// "docs" + "../spec/VERSIONING.md" -> "spec/VERSIONING.md"
function resolve(dir, href) {
  const segments = [];
  for (const segment of `${dir}/${href}`.split("/")) {
    if (segment === "." || segment === "") continue;
    if (segment === "..") segments.pop();
    else segments.push(segment);
  }
  return segments.join("/");
}

// The repository folder a rendered markdown file came from ("docs" or
// "spec"), or undefined for anything else.
function sourceDir(path) {
  return /[/\\](docs|spec)[/\\][^/\\]+\.md$/.exec(path ?? "")?.[1];
}

function walk(node, visit) {
  visit(node);
  for (const child of node.children ?? []) walk(child, visit);
}

export function rewriteMarkdownLinks({ base }) {
  return (tree, file) => {
    const dir = sourceDir(file.path);
    if (!dir) return;
    walk(tree, (node) => {
      if (node.type !== "element" || node.tagName !== "a") return;
      const href = node.properties?.href;
      if (typeof href !== "string") return;
      // absolute URLs, mail links and pure anchors stay as they are
      if (/^[a-z]+:/i.test(href) || href.startsWith("#") || href.startsWith("/")) return;

      const [path, anchor] = href.split("#");
      const suffix = anchor ? `#${anchor}` : "";
      const target = resolve(dir, path);
      if (specPages[target]) {
        node.properties.href = `${base}/spec/${specPages[target]}${suffix}`;
      } else if (target.startsWith("docs/")) {
        // docs pages are addressed without the .md extension
        node.properties.href = `${base}/${target.replace(/\.md$/, "")}${suffix}`;
      } else {
        node.properties.href = `${repoBlobUrl}/${target}${suffix}`;
      }
    });
  };
}
