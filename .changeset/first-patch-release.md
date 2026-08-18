---
"@testfile.dev/schema": patch
"@testfile.dev/core": patch
"@testfile.dev/runner": patch
"@testfile.dev/sync": patch
"@testfile.dev/mcp": patch
"@testfile.dev/tui": patch
"@testfile.dev/web": patch
"@testfile.dev/cli": patch
"@testfile.dev/eve": patch
"@testfile.dev/viewer": patch
"@testfile.dev/conformance": patch
---

First release managed by changesets: every package starts over at 0.0.0 and
this changeset takes them all to 0.0.1. The public packages — the schema and
the testfile-ts libraries and CLI — are published to npm from here on; the
private workspaces are only versioned along.
