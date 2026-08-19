// The whole documentation as one plain-text file: the markdown sources,
// in the order the menu lists them, for a model that should read
// everything rather than fetch page by page.
//
// The markdown is served as written - headings, code fences and tables are
// what a model reads best, and rendering it to HTML first would only take
// that structure away.
import type { APIRoute } from "astro";
import { getCollection } from "astro:content";
import { guideSlug, guideTestfiles, isGuide } from "../guides";
import { specPages } from "../spec";
import { toYaml } from "../wizard";

const SITE = "https://testfile.dev";

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
  const all = (await getCollection("docs")).sort(
    (a, b) => (a.data.order ?? 999) - (b.data.order ?? 999),
  );
  const docs = all.filter((doc) => !isGuide(doc));
  const guides = all.filter(isGuide);
  const spec = await getCollection("spec");
  const posts = (await getCollection("blog")).sort(
    (a, b) => b.data.date.getTime() - a.data.date.getTime(),
  );

  const parts = [
    [
      "# Testfile",
      "",
      "A declarative YAML format for running a project's tests: one file describes",
      "what to run, what it needs (services, ports, containers) and how to select",
      "subsets of it, so the same suite runs on a laptop and in any CI system.",
      "",
      "This file is the whole documentation, concatenated: the docs, the normative",
      "specification and the worked guides. An index of the same pages is at",
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
      "An interactive page, one question at a time: the language and its version,",
      "whether the tests run on this machine or in a container, and which PostgreSQL",
      "version they need - or every version of either, which fans the suite out over",
      "all of them. For Node.js 22 in a container with PostgreSQL 17 it produces:",
      "",
      "```yaml",
      toYaml({ language: "node", version: "22", runtime: "container", database: "17" }).trimEnd(),
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
    // Each guide is its markdown page plus the Testfile it renders - the
    // page embeds the file at build time, so the file is quoted here too.
    ...guides.map((guide) =>
      [
        section(guide.data.title, `${SITE}/guides/${guideSlug(guide)}`, guide.body ?? "").trimEnd(),
        "",
        "```yaml",
        (guideTestfiles[guideSlug(guide)] ?? "").trimEnd(),
        "```",
        "",
      ].join("\n"),
    ),
    // The blog is not documentation, but the index above promises the text
    // of every page, so the posts close the file.
    section(
      "Blog",
      `${SITE}/blog`,
      "News about the Testfile format and its tooling; the posts follow, newest first.",
    ),
    ...posts.map((post) => section(post.data.title, `${SITE}/blog/${post.id}`, post.body ?? "")),
  ];

  return new Response(parts.join("\n"), {
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
};
