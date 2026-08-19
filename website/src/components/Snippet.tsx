// Renders a file from a guide's folder (docs/guides/) as a highlighted code
// block, so a guide can quote its real Testfile - or any other of its files -
// instead of pasting a copy that would drift. Used from the guides' MDX:
//
//   <Snippet file="pytest-postgres/Testfile" />
//
// The files are pulled in at build time; the highlighter is the synchronous
// shiki core because this renders through React, which cannot await. Same
// themes as Astro's own <Code>, and the same .astro-code class, so the
// existing dark-mode CSS applies unchanged.
import { createHighlighterCoreSync } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import yaml from "@shikijs/langs/yaml";
import githubDark from "@shikijs/themes/github-dark";
import githubLight from "@shikijs/themes/github-light";

const sources = import.meta.glob(["../../../docs/guides/*/**", "!**/*.mdx"], {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

// ".../docs/guides/pytest-postgres/Testfile" -> "pytest-postgres/Testfile"
const files: Record<string, string> = Object.fromEntries(
  Object.entries(sources).map(([path, source]) => [
    path.split("/docs/guides/")[1]!,
    // the editor's schema hint is an instruction to the language server,
    // not part of the example
    source.replace(/^# yaml-language-server:.*\n/, ""),
  ]),
);

const highlighter = createHighlighterCoreSync({
  langs: [yaml],
  themes: [githubLight, githubDark],
  engine: createJavaScriptRegexEngine(),
});

interface Props {
  // Path relative to docs/guides/, e.g. "pytest-postgres/Testfile".
  file: string;
  // Language for the highlighting; the files shown are Testfiles, so yaml
  // unless said otherwise. Other languages need their grammar added above.
  lang?: string;
}

export default function Snippet({ file, lang = "yaml" }: Props) {
  const source = files[file];
  if (source === undefined) throw new Error(`Snippet: docs/guides/${file} does not exist`);
  const html = highlighter.codeToHtml(source, {
    lang,
    themes: { light: "github-light", dark: "github-dark" },
    defaultColor: "light",
    transformers: [
      {
        pre(node) {
          this.addClassToHast(node, "astro-code");
        },
      },
    ],
  });
  return <div className="snippet" dangerouslySetInnerHTML={{ __html: html }} />;
}
