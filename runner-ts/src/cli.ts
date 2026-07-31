#!/usr/bin/env node
import { dirname } from "node:path";
import { Command } from "commander";
import { Runner } from "./executor.js";
import { loadTestfile } from "./loader.js";
import { ConsoleReporter } from "./reporter.js";
import { buildRunTree, walk, type RunNode } from "./runtree.js";
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
    let runner: Runner;
    try {
      const { path: file, doc } = loadTestfile(path);
      runner = new Runner(doc, buildRunTree(doc), dirname(file));
    } catch (err) {
      console.error(`${color(31, "✘")} ${err instanceof Error ? err.message : err}`);
      process.exitCode = 1;
      return;
    }

    let interrupts = 0;
    const onSignal = () => {
      interrupts += 1;
      if (interrupts === 1) {
        console.error("\nstopping gracefully (Ctrl+C again to force)...");
        runner.requestStop();
      } else {
        runner.forceStop();
        process.exit(130);
      }
    };
    process.on("SIGINT", onSignal);
    process.on("SIGTERM", onSignal);

    if (options.tui && process.stdout.isTTY) {
      const [{ render }, React, { App }] = await Promise.all([
        import("ink"),
        import("react"),
        import("./tui.js"),
      ]);
      const app = render(React.createElement(App, { runner }), { exitOnCtrlC: false });
      const status = await runner.run();
      await app.waitUntilExit();
      process.exitCode = runner.interrupted ? 130 : status === "passed" ? 0 : 1;
    } else {
      if (options.tui) console.error("not a TTY, falling back to plain output");
      const reporter = new ConsoleReporter(runner, { verbose: options.verbose });
      const status = await runner.run();
      reporter.summary();
      process.exitCode = runner.interrupted ? 130 : status === "passed" ? 0 : 1;
    }
  });

await program.parseAsync(process.argv);
