---
"@testfile.dev/runner": patch
"@testfile.dev/cli": patch
---

The runner owns the commands that drive it. `start`, `doctor`, `validate`,
`inspect`, `tags`, `changes`, `init` and `completion` moved from
`@testfile.dev/cli` into `@testfile.dev/runner`, which now ships them two
ways: as the `testfile-runner` binary, so `npx @testfile.dev/runner start`
runs a suite without installing the reading half of the tool (the terminal
UI, the web viewer, the MCP server), and as `@testfile.dev/runner/cli`, the
subpath `testfile` registers them from — so the two binaries offer the same
commands with the same flags by construction. The library entry point is
unchanged and still parses no arguments.

`testfile` is unaffected: same commands, same order, same output.
