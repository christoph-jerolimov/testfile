#!/usr/bin/env node
import { dirname } from "node:path";
import { Command } from "commander";
import { HISTORY_DIR } from "./history.js";
import { loadTestfile } from "./loader.js";
import { ConsoleReporter } from "./reporter.js";
import { buildRunTree, walk, type RunNode } from "./runtree.js";
import { Session } from "./session.js";
import { color } from "./util.js";

const program = new Command();

program
  .name("testfile")
  .description("Run the tests described in a Testfile / testfile.yaml")
  .version("0.1.0");

program
  .command("validate")
  .argument("[path]", "Testfile or directory containing one", ".")
  .description("Validate a Testfile against the schema")
  .action((path: string) => {
    try {
      const { path: file } = loadTestfile(path);
      console.log(`${color(32, "✔")} ${file} is valid`);
    } catch (err) {
      console.error(`${color(31, "✘")} ${err instanceof Error ? err.message : err}`);
      process.exitCode = 1;
    }
  });

program
  .command("list")
  .argument("[path]", "Testfile or directory containing one", ".")
  .description("Print the expanded test tree (including matrix instances)")
  .action((path: string) => {
    try {
      const { doc } = loadTestfile(path);
      const tree = buildRunTree(doc);
      for (const [name] of Object.entries(doc.services ?? {})) {
        console.log(`${color(36, "◆")} service ${name}`);
      }
      walk(tree, (node: RunNode) => {
        const marker = node.children.length > 0 ? color(90, node.kind) : "";
        console.log(`${"  ".repeat(node.depth)}${node.name} ${marker}`.trimEnd());
        for (const [name] of Object.entries(node.def.services ?? {})) {
          if (!node.isMatrixWrapper) {
            console.log(`${"  ".repeat(node.depth + 1)}${color(36, "◆")} service ${name}`);
          }
        }
      });
    } catch (err) {
      console.error(`${color(31, "✘")} ${err instanceof Error ? err.message : err}`);
      process.exitCode = 1;
    }
  });

program
  .command("run", { isDefault: true })
  .argument("[path]", "Testfile or directory containing one", ".")
  .option("--tui", "interactive terminal UI", false)
  .option("-v, --verbose", "also stream service output", false)
  .description("Run the test tree")
  .action(async (path: string, options: { tui: boolean; verbose: boolean }) => {
    let session: Session;
    try {
      const { path: file, doc } = loadTestfile(path);
      session = new Session(doc, dirname(file));
    } catch (err) {
      console.error(`${color(31, "✘")} ${err instanceof Error ? err.message : err}`);
      process.exitCode = 1;
      return;
    }

    let interrupts = 0;
    const onSignal = () => {
      interrupts += 1;
      if (!session.running || !session.runner) {
        process.exit(130);
      } else if (interrupts === 1) {
        console.error("\nstopping gracefully (Ctrl+C again to force)...");
        session.runner.requestStop();
      } else {
        session.runner.forceStop();
        process.exit(130);
      }
    };
    process.on("SIGTERM", onSignal);

    if (options.tui && process.stdout.isTTY) {
      // The TUI starts idle: the user selects tests and runs them with enter.
      // Ctrl+C is handled inside the TUI (the terminal is in raw mode).
      const [{ render }, React, { App }] = await Promise.all([
        import("ink"),
        import("react"),
        import("./tui.js"),
      ]);
      const app = render(React.createElement(App, { session }), { exitOnCtrlC: false });
      await app.waitUntilExit();
      const status = session.runner?.root.status;
      process.exitCode =
        session.runner === undefined ? 0 : session.runner.interrupted ? 130 : status === "passed" ? 0 : 1;
    } else {
      if (options.tui) console.error("not a TTY, falling back to plain output");
      process.on("SIGINT", onSignal);
      let reporter: ConsoleReporter | undefined;
      session.on("runner", (runner) => {
        reporter = new ConsoleReporter(runner, { verbose: options.verbose });
      });
      const status = await session.runAll();
      reporter?.summary();
      if (session.lastRecord) {
        console.log(color(90, `run recorded in ${HISTORY_DIR}/runs/${session.lastRecord.id}`));
      }
      process.exitCode = session.runner!.interrupted ? 130 : status === "passed" ? 0 : 1;
    }
  });

await program.parseAsync(process.argv);
