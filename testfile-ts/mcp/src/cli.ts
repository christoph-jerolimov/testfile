#!/usr/bin/env node
// The MCP server as its own command: `npx @testfile.dev/mcp [path]` serves
// the recorded runs over stdio with just this package and the core reader
// installed - the line an .mcp.json points at. The same command is
// `testfile mcp` in @testfile.dev/cli, registered from here.
import { Command } from "commander";
import { registerMcp } from "./commands/index.js";

const program = new Command();

program
  .name("testfile-mcp")
  .description("Serve recorded Testfile runs to an AI assistant over MCP (stdio)")
  .version("0.1.0");

// `mcp` is the default command: a bare path (or nothing) starts the server.
registerMcp(program, { isDefault: true });

await program.parseAsync(process.argv);
