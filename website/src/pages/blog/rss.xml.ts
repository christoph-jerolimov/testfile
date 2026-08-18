// The blog as an RSS 2.0 feed, written by hand: the feed is a dozen lines
// of XML, not worth a dependency. Generated from the same collection the
// pages are built from, so it cannot drift from what is published.
import type { APIRoute } from "astro";
import { getCollection } from "astro:content";

const SITE = "https://testfile.dev";

function escapeXml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export const GET: APIRoute = async () => {
  const posts = (await getCollection("blog")).sort(
    (a, b) => b.data.date.getTime() - a.data.date.getTime(),
  );

  const items = posts.map((post) =>
    [
      "    <item>",
      `      <title>${escapeXml(post.data.title)}</title>`,
      `      <link>${SITE}/blog/${post.id}</link>`,
      `      <guid isPermaLink="true">${SITE}/blog/${post.id}</guid>`,
      `      <pubDate>${post.data.date.toUTCString()}</pubDate>`,
      `      <description>${escapeXml(post.data.description)}</description>`,
      "    </item>",
    ].join("\n"),
  );

  const feed = [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<rss version="2.0">',
    "  <channel>",
    "    <title>Testfile blog</title>",
    `    <link>${SITE}/blog</link>`,
    "    <description>News and guides around Testfile.</description>",
    ...items,
    "  </channel>",
    "</rss>",
    "",
  ].join("\n");

  return new Response(feed, {
    headers: { "content-type": "application/rss+xml; charset=utf-8" },
  });
};
