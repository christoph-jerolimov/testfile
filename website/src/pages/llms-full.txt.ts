// The whole documentation as one plain-text file: the markdown sources,
// in the order the menu lists them, for a model that should read
// everything rather than fetch page by page.
//
// The markdown is served as written - headings, code fences and tables are
// what a model reads best, and rendering it to HTML first would only take
// that structure away.
import type { APIRoute } from "astro";
import { getCollection } from "astro:content";
import { examples } from "../examples";
import { specPages } from "../spec";
import { toYaml } from "../wizard";

const SITE = "https://christoph-jerolimov.github.io/testfile";

// Frontmatter is metadata for the site builder, not content.
function withoutFrontmatter(markdown: string): string {
  return markdown.replace(/^---\n[\s\S]*?\n---\n/, "").trimStart();
}

// Every document is announced with where it came from, so a model quoting
// it can point at a page rather than at "the docs". Most pages open with
// their own title; repeating it above would only read as two documents.
function section(title: string, url: string, body: string): string {
  const text = withoutFrontmatter(body).trimEnd();
  const heading = /^#\s+(.+)$/.exec(text.split("\n", 1)[0] ?? "");
  return heading
    ? [
        `# ${heading[1]}`,
        "",
        `Source: ${url}`,
        "",
        text.split("\n").slice(1).join("\n").trimStart(),
        "",
      ].join("\n")
    : [`# ${title}`, "", `Source: ${url}`, "", text, ""].join("\n");
}

export const GET: APIRoute = async () => {
  const docs = (await getCollection("docs")).sort(
    (a, b) => (a.data.order ?? 999) - (b.data.order ?? 999),
  );
  const spec = await getCollection("spec");

  const parts = [
    [
      "# Testfile",
      "",
      "A declarative YAML format for running a project's tests: one file describes",
      "what to run, what it needs (services, ports, containers) and how to select",
      "subsets of it, so the same suite runs on a laptop and in any CI system.",
      "",
      "This file is the whole documentation, concatenated: the guides, the normative",
      "specification and the worked examples. An index of the same pages is at",
      `${SITE}/llms.txt.`,
      "",
    ].join("\n"),
    // The wizard page is interactive, so quoting its markup would say
    // nothing. What it produces is the useful part: one of its answers,
    // rendered, as the shape of a starter file.
    [
      "# Get started",
      "",
      `Source: ${SITE}/start`,
      "",
      "An interactive page: choose the language, whether the tests run on the machine",
      "or in a container, and whether they need a database, and it writes the starter",
      "Testfile for that combination. For Node.js in a container with PostgreSQL it",
      "produces:",
      "",
      "```yaml",
      toYaml({
        language: "node",
        runtime: "container",
        version: "22",
        database: "postgres",
        dbVersion: "17",
      }).trimEnd(),
      "```",
      "",
    ].join("\n"),
    ...docs.map((doc) => section(doc.data.title, `${SITE}/docs/${doc.id}`, doc.body ?? "")),
    ...specPages.map((page) =>
      section(
        page.title,
        `${SITE}/spec/${page.slug}`,
        spec.find((entry) => entry.id === page.id)?.body ?? "",
      ),
    ),
    // The examples are the Testfiles themselves; their prose lives in the
    // metadata, so the file is quoted rather than described.
    ...examples.map((example) =>
      [
        `# Example: ${example.meta.title}`,
        "",
        `Source: ${SITE}/examples/${example.id}`,
        "",
        example.meta.summary,
        "",
        ...example.meta.highlights.map((highlight) => `- ${highlight}`),
        "",
        "```yaml",
        example.testfile.trimEnd(),
        "```",
        "",
      ].join("\n"),
    ),
  ];

  return new Response(parts.join("\n"), {
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
};
