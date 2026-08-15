#!/usr/bin/env node
// eve: ask about the runs you already recorded.
//
//   eve "why did last night's run fail?"
//
// The same tools `testfile mcp` serves to an editor, driven from a terminal
// instead - for when the question is one sentence long and opening an
// assistant to ask it is the slow way round.
import { Command } from "commander";
import { RunHistory } from "@testfile/core";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { ask } from "./agent.js";

// The .testfile folder holding the runs, from a directory that has one.
function historyBase(path: string): string {
  const dir = resolve(path);
  if (!existsSync(dir)) throw new Error(`${dir} does not exist`);
  if (!existsSync(join(dir, ".testfile"))) {
    throw new Error(`no .testfile folder in ${dir} - run some tests first`);
  }
  return dir;
}

const program = new Command()
  .name("eve")
  .description("Ask questions about recorded Testfile runs")
  .argument("<question>", 'what to ask, e.g. "why is ci/checks/e2e flaky?"')
  .option("-C, --directory <path>", "directory containing a .testfile folder", ".")
  .option("-q, --quiet", "only print the answer, not the tools it used", false)
  .action(async (question: string, options: { directory: string; quiet: boolean }) => {
    try {
      if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
        // The SDK also reads a profile written by `ant auth login`, so this
        // is a hint rather than a hard failure.
        process.stderr.write(
          "eve: no ANTHROPIC_API_KEY set - falling back to whatever credentials the SDK finds\n",
        );
      }
      const history = new RunHistory(historyBase(options.directory));
      const answer = await ask({
        history,
        question,
        onToolUse: options.quiet ? undefined : (name) => process.stderr.write(`  … ${name}\n`),
      });
      process.stdout.write(`${answer}\n`);
    } catch (err) {
      process.stderr.write(`✘ ${err instanceof Error ? err.message : String(err)}\n`);
      process.exitCode = 1;
    }
  });

await program.parseAsync(process.argv);
