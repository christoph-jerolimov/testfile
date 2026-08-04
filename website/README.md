# website

The Astro site that renders the end-user documentation from
[`../docs/`](../docs/), published to GitHub Pages at
[christoph-jerolimov.github.io/testfile](https://christoph-jerolimov.github.io/testfile/)
by [`deploy-website.yaml`](../.github/workflows/deploy-website.yaml) on every
push to `main`.

Pages are ordered by the `order` field in each doc's frontmatter — core
concepts first (what is a Testfile, getting started, writing tests), the
special-purpose guides after (matrix, services, environment, CLI/TUI, GitHub
Action).

The three normative documents in [`../spec/`](../spec/) are published the
same way, under `/spec/` — see [`src/spec.ts`](src/spec.ts) for their routes
and menu labels. Both folders are read at build time, so the markdown files
in the repository stay the single source; the relative links they use for
GitHub are rewritten for the site by
[`src/markdown-links.mjs`](src/markdown-links.mjs).

```sh
npm run dev --workspace website     # local preview with live reload
npm run build --workspace website   # build to dist/
```
