#!/usr/bin/env node
// The runner as a command: just the half of the `testfile` command line
// that reads the Testfile and runs it. This is what `npx
// @testfile.dev/runner start` executes - a CI job (or the GitHub action)
// gets the runner and its few dependencies, nothing of the read-only
// tooling. The full command line, history commands included, is
// @testfile.dev/cli.
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
} from "./commands/index.js";

const program = new Command();

program
  .name("testfile-runner")
  .description("Run the tests described in a Testfile")
  .version("0.1.0");

registerInit(program);
registerValidate(program);
registerInspect(program);
registerTags(program);
registerChanges(program);
registerDoctor(program);
// `start` is the default command
registerStart(program);

registerCompletion(program);

await program.parseAsync(process.argv);
