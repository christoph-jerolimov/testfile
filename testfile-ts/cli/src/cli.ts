#!/usr/bin/env node
// One command line over two halves of the same tool.
//
// The suite commands - what the Testfile describes, and running it - live
// in @testfile.dev/runner, the only package that starts processes, and are
// registered from there (so `npx @testfile.dev/runner start` is the same
// code). The history commands ask things of the runs that came out, over
// the read-only packages: the sharing commands live in @testfile.dev/sync
// and the MCP server's in @testfile.dev/mcp, next to the code they drive;
// history/ holds the rest (core, tui, web). Nothing anywhere does the work
// itself: a command parses flags, calls a library and prints.
//
// Keeping them in one binary means `testfile start` and `testfile explain`
// are the same tool, and the heavy parts stay behind an import that only
// happens when the command that needs them is the one being run.
import { Command } from "commander";
import {
  registerChanges,
  registerCompletion,
  registerDoctor,
  registerInit,
  registerInspect,
  registerStart,
  registerTags,
  registerValidate,
} from "@testfile.dev/runner/commands";
import { registerMcp } from "@testfile.dev/mcp/commands";
import {
  registerArchive,
  registerGithub,
  registerGitlab,
  registerS3,
} from "@testfile.dev/sync/commands";
import { registerDiff } from "./history/diff.js";
import { registerExplain } from "./history/explain.js";
import { registerInspectRun } from "./history/inspect.js";
import { registerMerge } from "./history/merge.js";
import { registerRepro } from "./history/repro.js";
import { registerRuns } from "./history/runs.js";
import { registerServe } from "./history/serve.js";
import { registerTui } from "./history/tui.js";

const program = new Command();

program
  .name("testfile")
  .description("Run the tests described in a Testfile, and read the runs that came out")
  .version("0.1.0");

// The Testfile: what it says, and running it.
registerInit(program);
registerValidate(program);
// `inspect` shows the suite; `inspect run <id>` shows one recorded run
registerInspectRun(registerInspect(program));
registerTags(program);
registerChanges(program);
registerDoctor(program);
// `start` is the default command
registerStart(program);

// The runs that came out of it.
registerRuns(program);
registerExplain(program);
registerRepro(program);
registerDiff(program);
registerMerge(program);
registerTui(program);
registerServe(program);
registerMcp(program);
// the sharing backends have their own groups
registerArchive(program);
registerS3(program);
registerGithub(program);
registerGitlab(program);

registerCompletion(program);

await program.parseAsync(process.argv);
