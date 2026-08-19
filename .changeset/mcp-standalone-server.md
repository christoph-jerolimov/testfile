---
"@testfile.dev/mcp": patch
---

The MCP server is its own command: `npx @testfile.dev/mcp [path]` serves
the recorded runs over stdio with nothing but this package installed. The
new `testfile-mcp` bin makes `mcp` its default command; `testfile mcp` in
the full cli is unchanged.
