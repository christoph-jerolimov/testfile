# viewer-web

The React web viewer over recorded Testfile runs — the browser sibling of
the TUI's runs/results views. It is not used standalone: `testfile serve`
(see [`runner-ts`](../runner-ts/)) serves the bundle from `dist/` on
`127.0.0.1` together with the read-only REST API it talks to, and picks the
build up automatically.

```sh
npm run build --workspace viewer-web   # bundle with esbuild into dist/
npm test --workspace viewer-web        # typecheck + unit tests + build
```

## End-to-end tests

The Playwright suite drives the real viewer in a real browser: it serves
the committed fixture history in `e2e/fixture/` through
`testfile-viewer serve` and asserts the runs/results views, log loading —
and pixel-compares each view against the committed screenshots in
`e2e/__screenshots__/`:

```sh
npm run build --workspace viewer-ts            # serve comes from viewer-ts
npm run test:e2e --workspace viewer-web        # run (compares screenshots)
npm run test:e2e:update --workspace viewer-web # refresh the screenshots
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
