# @testfile.dev/mcp

The recorded runs of a [Testfile](https://github.com/testfile-dev/testfile)
suite, served over the
[Model Context Protocol](https://modelcontextprotocol.io) — so an assistant
that speaks MCP (Claude Code, Claude Desktop, an agent of your own) can
read the history under `.testfile/` as data instead of parsing terminal
output. Everything it serves is read-only: `list_runs`, `get_run`,
`explain_run`, `repro_test`, `get_test_log`, `diff_runs`, `list_tests`,
`list_flaky`.

The package is its own server command (stdio), so a config needs nothing
but `npx`:

```jsonc
// .mcp.json, or Claude Desktop's config
{
  "mcpServers": {
    "testfile": {
      "command": "npx",
      "args": ["-y", "@testfile.dev/mcp", "/path/to/your/project"]
    }
  }
}
```

(Installed, the command is called `testfile-mcp`; the same command is
`testfile mcp` in the full [`@testfile.dev/cli`](../cli/).) It is a
library too: the server (`serveStdio`) and the tools (`testfileTools`)
are exported for embedding.

Full documentation:
[testfile.dev/docs/cli](https://testfile.dev/docs/cli#talking-to-an-ai-assistant).

Requires Node.js >= 20. Apache-2.0.
