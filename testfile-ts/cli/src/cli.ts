#!/usr/bin/env node
// One command line over two halves of the same tool.
//
// `suite/` asks things of the Testfile - what it describes, and running
// it - and reaches for @testfile/runner, the only package that starts
// processes. `history/` asks things of the runs that came out, over the
// read-only packages (core, sync, mcp, tui, web). Nothing here does any
// work itself: a command parses flags, calls a library and prints.
//
// Keeping them in one binary means `testfile start` and `testfile explain`
// are the same tool, and the heavy parts stay behind an import that only
// happens when the command that needs them is the one being run.
import { Command } from "commander";
import { registerArchive } from "./history/archive.js";
import { registerDiff } from "./history/diff.js";
import { registerExplain } from "./history/explain.js";
import { registerGithub } from "./history/github.js";
import { registerGitlab } from "./history/gitlab.js";
import { registerInspectRun } from "./history/inspect.js";
import { registerMcp } from "./history/mcp.js";
import { registerMerge } from "./history/merge.js";
import { registerRepro } from "./history/repro.js";
import { registerRuns } from "./history/runs.js";
import { registerS3 } from "./history/s3.js";
import { registerServe } from "./history/serve.js";
import { registerTui } from "./history/tui.js";
import { registerChanges } from "./suite/changes.js";
import { registerCompletion } from "./suite/completion.js";
import { registerDoctor } from "./suite/doctor.js";
import { registerInit } from "./suite/init.js";
import { registerInspect } from "./suite/inspect.js";
import { registerStart } from "./suite/start.js";
import { registerTags } from "./suite/tags.js";
import { registerValidate } from "./suite/validate.js";

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
