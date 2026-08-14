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
[`src/markdown-links.ts`](src/markdown-links.ts).

Because the docs link each other by heading, renaming a page or a heading
breaks links in files nobody touched.
[`scripts/check-links.ts`](scripts/check-links.ts) resolves every internal
`href` and `src` of the built site — anchors included — against `dist/`, and
fails when one of them points nowhere. External links are not fetched, so the
check works offline. It runs as the `links` test of the repository's
[`Testfile`](../Testfile).

## TypeScript

Everything in this workspace is TypeScript — the pages, the two checkers,
the Astro config and the tests. The checkers are compiled to `out/` and run
from there (`npm run build:scripts`, which their `pre` scripts do for you);
`npm run typecheck --workspace website` checks the rest. Astro components
themselves are checked by the build, not by `tsc`.

## Tests

Nothing here is tested by importing it. The two checkers are run as the
commands the CI job runs, over a directory of built pages, and judged by
what they report and the code they exit with.

The [`/start`](src/pages/start.astro) wizard asks its questions one at a
time — nothing is preselected, and the next one appears once the current one
is answered — and it is tested the same way, one level up:
[`e2e/wizard.spec.ts`](e2e/wizard.spec.ts) opens the built page in a
browser, answers by clicking the labels a reader sees, and compares the file
it builds with the ones committed in
[`e2e/expected/`](e2e/expected/) — written by hand, not generated. A test
that asked [`src/wizard.ts`](src/wizard.ts) what it produces could only
prove that the code equals itself, so there is deliberately no way to
refresh those files automatically: a changed one has to be read and
re-approved. The suite also walks every combination the page offers,
discovered from the page rather than from the code, and validates each
against the JSON schema.

The browser suite needs a build first (it serves `dist/` into the browser by
answering its requests, so there is no server to start) and a Chromium. On a
machine that cannot download the one Playwright asks for, point
`TESTFILE_E2E_CHROMIUM` at an existing browser.

```sh
npm run dev --workspace website          # local preview with live reload
npm run build --workspace website        # build to dist/
npm run check:links --workspace website  # every internal link resolves
npm test --workspace website             # the checkers' own tests
npm run test:e2e --workspace website     # build, then the wizard in a browser
```
