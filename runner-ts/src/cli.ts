#!/usr/bin/env node
// The runner: reads a Testfile, runs the processes it describes and writes
// the recorded run. Each command lives in its own file under commands/;
// the read-only side (browsing recorded runs) is `testfile-viewer`.
import { Command } from "commander";
import { registerChanges } from "./commands/changes.js";
import { registerCompletion } from "./commands/completion.js";
import { registerInit } from "./commands/init.js";
import { registerList } from "./commands/list.js";
import { registerRun } from "./commands/run.js";
import { registerTags } from "./commands/tags.js";
import { registerValidate } from "./commands/validate.js";

const program = new Command();

program
  .name("testfile")
  .description("Run the tests described in a Testfile / testfile.yaml")
  .version("0.1.0");

registerInit(program);
registerValidate(program);
registerList(program);
// `run` is the default command
registerRun(program);
registerTags(program);
registerChanges(program);
registerCompletion(program);

await program.parseAsync(process.argv);
