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

```sh
npm run dev --workspace website     # local preview with live reload
npm run build --workspace website   # build to dist/
```
