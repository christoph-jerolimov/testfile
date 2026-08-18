#!/usr/bin/env node
// The runner as a command line of its own: `testfile-runner start` and the
// commands around it.
//
// The full `testfile` binary (@testfile.dev/cli) registers exactly these
// commands too, beside everything it can tell you about the runs that came
// out. This entry point exists for the place that only ever runs a suite -
// a CI job, the bundled GitHub Action - where installing the reading half
// (Ink, React, the web viewer, the MCP server) buys nothing.
import { Command } from "commander";
import { registerCompletion, registerSuiteCommands } from "./index.js";

const program = new Command();

program
  .name("testfile-runner")
  .description("Run the tests described in a Testfile")
  .version("0.1.0");

registerSuiteCommands(program);
// last, so it sees every command it is asked to complete
registerCompletion(program);

await program.parseAsync(process.argv);
