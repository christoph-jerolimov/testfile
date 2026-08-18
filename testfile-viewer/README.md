# testfile-viewer

The React web viewer over recorded Testfile runs — the browser sibling of
the TUI's runs/results views. It is not used standalone: `testfile serve`
(see [`web`](../testfile-ts/web/)) serves the bundle from `dist/` on
`127.0.0.1` together with the read-only REST API it talks to, and picks the
build up automatically.

```sh
npm run dev --workspace testfile-viewer     # vite dev server
npm run build --workspace testfile-viewer   # vite build into dist/
npm test --workspace testfile-viewer        # typecheck + unit tests + build
```

Vite emits `dist/index.html` with hashed assets beside it, and `base` is
`/` rather than relative: `testfile serve` mounts the viewer at the root and
falls back to the index for unknown paths, so a deep link like
`/runs/20260101-120000-fx01` must not send the browser looking for
`/runs/assets/...`.

## The two TanStack libraries

**Query** owns everything read from the server. [`src/api.ts`](src/api.ts)
declares one `queryOptions` per endpoint and nothing else calls `fetch`, so
a view asks for `runsQuery` and gets the cached copy. Nothing polls: the
server pushes over `/api/events`, and that ping is a single
`invalidateQueries` — the runs refetch, and so does the log of whichever
view is open, which is why no component is handed a revision counter to
notice that a running test wrote another line.

**Table** owns the two sortable grids, the runs and the tests, through
[`src/components/DataTable.tsx`](src/components/DataTable.tsx) — the row
model and the sorting, with only the features the viewer asks for compiled
in. The suite tree and the services list stay plain `<table>`s: they are a
hierarchy and a three-row list, neither of which sorts or paginates.

## End-to-end tests

The Playwright suite drives the real viewer in a real browser: it serves
the committed fixture history in `e2e/fixture/` through
`testfile-viewer serve` and asserts the runs/results views, log loading —
and pixel-compares each view against the committed screenshots in
`e2e/__screenshots__/`:

```sh
npm run build --workspace @testfile.dev/cli       # serve comes from the CLI
npm run test:e2e --workspace testfile-viewer        # run (compares screenshots)
npm run test:e2e:update --workspace testfile-viewer # refresh the screenshots
```

After a deliberate UI change, run `test:e2e:update` and commit the updated
images. `@playwright/test` is pinned exactly so every machine renders with
the same browser build (set `PLAYWRIGHT_BROWSERS_PATH` if your browsers
live outside the default cache, or run `npx playwright install chromium`).
The root [`Testfile`](../Testfile) runs this suite in CI with
`testfile-viewer serve` started as a Testfile service (`TESTFILE_E2E_URL`
points the suite at an already-running server).

See the [web viewer documentation](../docs/cli.md#the-web-viewer) for what
it shows and the API endpoints.
