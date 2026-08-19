# @testfile.dev/sync

## 0.0.1

### Patch Changes

- [#197](https://github.com/testfile-dev/testfile/pull/197) First release managed by changesets: every package starts over at 0.0.0 and
  this changeset takes them all to 0.0.1. The public packages — the schema and
  the testfile-ts libraries and CLI — are published to npm from here on; the
  private workspaces are only versioned along.

- [#213](https://github.com/testfile-dev/testfile/pull/213) The sync and mcp packages own their commands, like the runner does: the
  sharing commands (`archive`, `s3`, `github`, `gitlab`) moved into
  `@testfile.dev/sync` and the `mcp` command into `@testfile.dev/mcp`, each
  exported as `<package>/commands` and registered from there by the cli.
  The helpers every command line over the recorded runs shares -
  `resolveHistoryBase`, `commandFailed`, `wantsJson`, `writeJson` - now live
  in `@testfile.dev/core`. The `testfile` command line is unchanged.
- Updated dependencies [[`1c19af6`](https://github.com/testfile-dev/testfile/commit/1c19af6b2209d5d575dea8aa92685842c30a5ea2), [`8d2555e`](https://github.com/testfile-dev/testfile/commit/8d2555eeea335fb74388f2ec545a4aaa3f580775)]:
  - @testfile.dev/core@0.0.1
