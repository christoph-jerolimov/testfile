import type { Command } from "commander";
import { serveStdio } from "../mcp/protocol.js";
import { testfileTools } from "../mcp/tools.js";
import { RunHistory } from "@testfile/core";
import { commandFailed, resolveHistoryBase } from "./shared.js";

const INSTRUCTIONS = [
  "Recorded Testfile runs: what ran, what failed, and why.",
  "",
  "When a run is red, start with explain_run - it names the failing tests, the end of",
  "each log, and whether the history already calls the test flaky. repro_test then gives",
  "the command that reruns exactly one test.",
  "",
  "Everything here reads. To run tests, call the runner itself:",
  "`testfile start -n <test>`, or `testfile start --json-stream` to follow a run live.",
].join("\n");

export function registerMcp(program: Command): void {
  program
    .command("mcp")
    .argument("[path]", "directory containing a .testfile folder", ".")
    .description("Serve the recorded runs to an AI assistant over MCP (stdio)")
    .action((path: string) => {
      try {
        const base = resolveHistoryBase(path);
        // The history is re-read per call, so runs recorded while an
        // assistant is connected are visible without a restart. It is
        // opened once here so an unreadable path fails now, not later.
        const history = new RunHistory(base);
        serveStdio(
          process.stdin,
          process.stdout,
          {
            name: "testfile",
            version: "0.1.0",
            instructions: INSTRUCTIONS,
          },
          testfileTools(() => history),
        );
        // stdin ending is the client hanging up.
        process.stdin.on("end", () => process.exit(0));
      } catch (err) {
        commandFailed(err);
      }
    });
}
