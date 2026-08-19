// https://llmstxt.org - an index of this site written for a model rather
// than a crawler: one line per page, with the sentence that says what is
// on it, so an assistant can pick the two pages it needs instead of being
// fed the whole site.
//
// Generated from the same collections the pages are built from, so it
// cannot drift from what is published.
import type { APIRoute } from "astro";
import { getCollection } from "astro:content";
import { compareDocs } from "../docs";
import { guideSlug, isGuide } from "../guides";
import { specPages } from "../spec";

const SITE = "https://testfile.dev";

// A one-line entry: the link, then what the page answers.
function entry(title: string, path: string, description: string): string {
  return `- [${title}](${SITE}${path}): ${description}`;
}

export const GET: APIRoute = async () => {
  const all = await getCollection("docs");
  const docs = all.filter((doc) => !isGuide(doc)).sort(compareDocs);
  const guides = all.filter(isGuide).sort((a, b) => a.data.order - b.data.order);
  const posts = (await getCollection("blog")).sort(
    (a, b) => b.data.date.getTime() - a.data.date.getTime(),
  );

  const lines = [
    "# Testfile",
    "",
    "> A declarative YAML format for running a project's tests: one file describes",
    "> what to run, what it needs (services, ports, containers) and how to select",
    "> subsets of it, so the same suite runs on a laptop and in any CI system.",
    "",
    "The format is specified independently of its implementation. This site",
    "documents the reference implementation (the `testfile` command line) and",
    "the normative specification it follows.",
    "",
    "## Documentation",
    "",
    entry(
      "Get started",
      "/start",
      "a wizard: pick a language and version, local or container, and a PostgreSQL version - or all of them, which fans the suite out over every one - and the page writes the starter Testfile for exactly that",
    ),
    ...docs.map((doc) =>
      entry(doc.data.title, `/docs/${doc.id}`, doc.data.description ?? doc.data.title),
    ),
    "",
    "## Specification",
    "",
    ...specPages.map((page) => entry(page.title, `/spec/${page.slug}`, page.description)),
    "",
    "## Guides",
    "",
    ...guides.map((guide) =>
      entry(guide.data.title, `/guides/${guideSlug(guide)}`, guide.data.description ?? guide.data.title),
    ),
    "",
    "## Blog",
    "",
    entry("Blog", "/blog", "news about the Testfile format and its tooling, newest first"),
    ...posts.map((post) => entry(post.data.title, `/blog/${post.id}`, post.data.description)),
    "",
    "## Optional",
    "",
    entry(
      "Everything, in one file",
      "/llms-full.txt",
      "the full text of every page above, for when the whole documentation should be read at once",
    ),
    "- [Source repository](https://github.com/testfile-dev/testfile): the runner, the viewer, the JSON schemas and the conformance suite",
    "",
  ];
  return new Response(lines.join("\n"), {
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
};
