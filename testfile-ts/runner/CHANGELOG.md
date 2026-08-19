# @testfile.dev/runner

## 0.0.1

### Patch Changes

- [#215](https://github.com/testfile-dev/testfile/pull/215) Service containers accept the engine's own network modes: `network: host`,
  `none` and `bridge` are joined as such — nothing is created and no
  `--network-alias` is passed, which the engines reject for anything but a
  user-defined network. `host` is how a container service and the machine
  reach each other on localhost.

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
- Updated dependencies [[`1c19af6`](https://github.com/testfile-dev/testfile/commit/1c19af6b2209d5d575dea8aa92685842c30a5ea2), [`8d2555e`](https://github.com/testfile-dev/testfile/commit/8d2555eeea335fb74388f2ec545a4aaa3f580775)]:
  - @testfile.dev/schema@0.0.1
  - @testfile.dev/core@0.0.1
