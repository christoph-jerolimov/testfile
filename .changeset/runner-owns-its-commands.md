---
"@testfile.dev/runner": patch
"@testfile.dev/cli": patch
---

The runner owns its commands: `start`, `init`, `validate`, `doctor`,
`inspect`, `tags`, `changes` and `completion` moved from the cli package
into `@testfile.dev/runner`, which now ships them behind its own bin
(`testfile-runner`) — so `npx @testfile.dev/runner start` works with just
the runner and its few dependencies, and the GitHub action installs only
those. The `testfile` command line is unchanged: `@testfile.dev/cli`
registers the same commands from the runner next to its read-only history
half.
