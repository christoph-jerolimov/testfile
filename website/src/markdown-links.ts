// The markdown files the website renders live in the repository and link
// each other the way GitHub reads them: docs/index.md points at
// "./getting-started", spec/TESTFILE.md at "RESULTS.md" or at
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
// config, before the content collections exist).
const specPages: Record<string, string> = {
  "spec/TESTFILE.md": "testfile",
  "spec/RESULTS.md": "test-result",
  "spec/VERSIONING.md": "versioning",
};

const repoBlobUrl = "https://github.com/testfile-dev/testfile/blob/main";

// A node of the rendered document; only elements and their children are
// looked at, so this is all the shape that matters here.
interface Node {
  type?: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: Node[];
}

// "docs" + "../spec/VERSIONING.md" -> "spec/VERSIONING.md"
function resolve(dir: string, href: string): string {
  const segments: string[] = [];
  for (const segment of `${dir}/${href}`.split("/")) {
    if (segment === "." || segment === "") continue;
    if (segment === "..") segments.pop();
    else segments.push(segment);
  }
  return segments.join("/");
}

// The repository folder a rendered markdown file came from ("docs",
// "docs/guides" or "spec"), or undefined for anything else.
function sourceDir(path: string | undefined): string | undefined {
  return /[/\\](docs(?:[/\\]guides)?|spec)[/\\][^/\\]+\.md$/
    .exec(path ?? "")?.[1]
    ?.replace(/\\/g, "/");
}

function walk(node: Node, visit: (node: Node) => void): void {
  visit(node);
  for (const child of node.children ?? []) walk(child, visit);
}

export function rewriteMarkdownLinks({ base }: { base: string }) {
  return (tree: Node, file: { path?: string }): void => {
    const dir = sourceDir(file.path);
    if (!dir) return;
    walk(tree, (node) => {
      if (node.type !== "element" || node.tagName !== "a") return;
      const properties = node.properties;
      const href = properties?.href;
      if (!properties || typeof href !== "string") return;
      // absolute URLs, mail links and pure anchors stay as they are
      if (/^[a-z]+:/i.test(href) || href.startsWith("#") || href.startsWith("/")) return;

      const [path, anchor] = href.split("#");
      const suffix = anchor ? `#${anchor}` : "";
      const target = resolve(dir, path);
      if (specPages[target]) {
        properties.href = `${base}/spec/${specPages[target]}${suffix}`;
      } else if (target.startsWith("docs/guides/")) {
        // the guides live in docs/guides/ but are published under /guides/
        const name = target.slice("docs/guides/".length).replace(/\.md$/, "");
        properties.href = `${base}/guides/${name}${suffix}`;
      } else if (target.startsWith("docs/")) {
        // docs pages are addressed without the .md extension
        properties.href = `${base}/${target.replace(/\.md$/, "")}${suffix}`;
      } else {
        properties.href = `${repoBlobUrl}/${target}${suffix}`;
      }
    });
  };
}
