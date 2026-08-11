#!/usr/bin/env node
// The read-only companion of the `testfile` runner: everything here works
// on the recorded runs in .testfile/ and never touches the Testfile or
// starts processes. Each command lives in its own file under commands/.
import { Command } from "commander";
import { registerArchive } from "./commands/archive.js";
import { registerDiff } from "./commands/diff.js";
import { registerExplain } from "./commands/explain.js";
import { registerGithub } from "./commands/github.js";
import { registerGitlab } from "./commands/gitlab.js";
import { registerMerge } from "./commands/merge.js";
import { registerInspect } from "./commands/inspect.js";
import { registerRepro } from "./commands/repro.js";
import { registerRuns } from "./commands/runs.js";
import { registerS3 } from "./commands/s3.js";
import { registerServe } from "./commands/serve.js";
import { registerTui } from "./commands/tui.js";

const program = new Command();

program
  .name("testfile-viewer")
  .description("Inspect, browse and share recorded Testfile runs (read-only)")
  .version("0.1.0");

registerInspect(program);
registerExplain(program);
registerRepro(program);
registerDiff(program);
registerMerge(program);
registerTui(program);
registerServe(program);
// `runs` is the default command; the sharing backends have their own groups
registerRuns(program);
registerArchive(program);
registerS3(program);
registerGithub(program);
registerGitlab(program);

await program.parseAsync(process.argv);
