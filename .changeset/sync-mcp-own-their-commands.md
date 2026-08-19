---
"@testfile.dev/core": patch
"@testfile.dev/sync": patch
"@testfile.dev/mcp": patch
"@testfile.dev/cli": patch
---

The sync and mcp packages own their commands, like the runner does: the
sharing commands (`archive`, `s3`, `github`, `gitlab`) moved into
`@testfile.dev/sync` and the `mcp` command into `@testfile.dev/mcp`, each
exported as `<package>/commands` and registered from there by the cli.
The helpers every command line over the recorded runs shares -
`resolveHistoryBase`, `commandFailed`, `wantsJson`, `writeJson` - now live
in `@testfile.dev/core`. The `testfile` command line is unchanged.
