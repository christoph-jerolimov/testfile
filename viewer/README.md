# viewer

The React web viewer over recorded Testfile runs — the browser sibling of
the TUI's runs/results views. It is not used standalone: `testfile serve`
(see [`runner-ts`](../runner-ts/)) serves the bundle from `dist/` on
`127.0.0.1` together with the read-only REST API it talks to, and picks the
build up automatically.

```sh
npm run build --workspace viewer   # bundle with esbuild into dist/
npm test --workspace viewer        # typecheck + build
```

See the [web viewer documentation](../docs/cli.md#the-web-viewer) for what
it shows and the API endpoints.
