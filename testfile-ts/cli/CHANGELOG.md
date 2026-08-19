# @testfile.dev/cli

## 0.0.1

### Patch Changes

- [#197](https://github.com/testfile-dev/testfile/pull/197) First release managed by changesets: every package starts over at 0.0.0 and
  this changeset takes them all to 0.0.1. The public packages — the schema and
  the testfile-ts libraries and CLI — are published to npm from here on; the
  private workspaces are only versioned along.

- [#213](https://github.com/testfile-dev/testfile/pull/213) The runner owns its commands: `start`, `init`, `validate`, `doctor`,
  `inspect`, `tags`, `changes` and `completion` moved from the cli package
  into `@testfile.dev/runner`, which now ships them behind its own bin
  (`testfile-runner`) — so `npx @testfile.dev/runner start` works with just
  the runner and its few dependencies, and the GitHub action installs only
  those. The `testfile` command line is unchanged: `@testfile.dev/cli`
  registers the same commands from the runner next to its read-only history
  half.

- [#213](https://github.com/testfile-dev/testfile/pull/213) The sync and mcp packages own their commands, like the runner does: the
  sharing commands (`archive`, `s3`, `github`, `gitlab`) moved into
  `@testfile.dev/sync` and the `mcp` command into `@testfile.dev/mcp`, each
  exported as `<package>/commands` and registered from there by the cli.
  The helpers every command line over the recorded runs shares -
  `resolveHistoryBase`, `commandFailed`, `wantsJson`, `writeJson` - now live
  in `@testfile.dev/core`. The `testfile` command line is unchanged.
- Updated dependencies [[`9ae62a3`](https://github.com/testfile-dev/testfile/commit/9ae62a322cecdb1da708fc21fd9d4080da13604b), [`1c19af6`](https://github.com/testfile-dev/testfile/commit/1c19af6b2209d5d575dea8aa92685842c30a5ea2), [`f2b06fc`](https://github.com/testfile-dev/testfile/commit/f2b06fc6391bbf8882a009041d3afda39c6fbc4d), [`ac40a85`](https://github.com/testfile-dev/testfile/commit/ac40a85b5ed55e33e233f446f7470a115c4e0b3f), [`8d2555e`](https://github.com/testfile-dev/testfile/commit/8d2555eeea335fb74388f2ec545a4aaa3f580775)]:
  - @testfile.dev/runner@0.0.1
  - @testfile.dev/core@0.0.1
  - @testfile.dev/sync@0.0.1
  - @testfile.dev/mcp@0.0.1
  - @testfile.dev/web@0.0.1
