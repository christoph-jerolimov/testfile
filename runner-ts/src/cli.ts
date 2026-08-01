#!/usr/bin/env node
import { dirname } from "node:path";
import { Command } from "commander";
import { findMatchingNodes, matchesMatrixFilters, parseMatrixFilters } from "./filter.js";
import { HISTORY_DIR } from "./history.js";
import { loadTestfile } from "./loader.js";
import { ConsoleReporter } from "./reporter.js";
import { walk, type RunNode } from "./runtree.js";
import { Session } from "./session.js";
import { color } from "./util.js";

const program = new Command();

const collect = (value: string, previous: string[]) => [...previous, value];

interface FilterFlags {
  filter: string[];
  matrixFilter: string[];
}

// Turns --filter/--matrix-filter values into the selection + exclusion that
// Session.runSelected expects, plus the resulting set of nodes for display.
function resolveFilters(
  session: Session,
  flags: FilterFlags
): { selection: number[]; exclude?: (node: RunNode) => boolean; active: Set<number>; leafCount: number } {
  let selection = [session.tree.id];
  if (flags.filter.length > 0) {
    selection = findMatchingNodes(session.tree, flags.filter).map((node) => node.id);
  }
  const matrixFilters = parseMatrixFilters(flags.matrixFilter);
  const exclude =
    matrixFilters.size > 0
      ? (node: RunNode) => !matchesMatrixFilters(node, matrixFilters)
      : undefined;
  const active = session.activeSetFor(selection);
  if (exclude) {
    for (const id of [...active]) {
      const node = session.byId.get(id);
      if (node && exclude(node)) active.delete(id);
    }
  }
  let leafCount = 0;
  for (const id of active) {
    if (session.byId.get(id)?.children.length === 0) leafCount++;
  }
  return { selection, exclude, active, leafCount };
}

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
  .option("--filter <name-or-path>", "only tests whose path contains this (repeatable)", collect, [])
  .option("--matrix-filter <key:value>", "only matrix instances with this value (repeatable)", collect, [])
  .description("Print the expanded test tree (including matrix instances)")
  .action((path: string, flags: FilterFlags) => {
    try {
      const { path: file, doc } = loadTestfile(path);
      const session = new Session(doc, dirname(file));
      const { active, leafCount } = resolveFilters(session, flags);
      if (leafCount === 0) throw new Error("no tests match the given filters");
      for (const [name] of Object.entries(doc.services ?? {})) {
        console.log(`${color(36, "◆")} service ${name}`);
      }
      walk(session.tree, (node: RunNode) => {
        if (!active.has(node.id)) return;
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
  .option("--filter <name-or-path>", "only run tests whose path contains this (repeatable)", collect, [])
  .option("--matrix-filter <key:value>", "only run matrix instances with this value (repeatable)", collect, [])
  .description("Run the test tree")
  .action(async (path: string, options: { tui: boolean; verbose: boolean } & FilterFlags) => {
    let session: Session;
    let filtered: ReturnType<typeof resolveFilters>;
    try {
      const { path: file, doc } = loadTestfile(path);
      session = new Session(doc, dirname(file));
      filtered = resolveFilters(session, options);
      if (filtered.leafCount === 0) throw new Error("no tests match the given filters");
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
      // Filter flags pre-select the matching tests. Ctrl+C is handled inside
      // the TUI (the terminal is in raw mode).
      const initialSelection =
        options.filter.length > 0 || options.matrixFilter.length > 0
          ? [...filtered.active].filter((id) => session.byId.get(id)?.children.length === 0)
          : [];
      const [{ render }, React, { App }] = await Promise.all([
        import("ink"),
        import("react"),
        import("./tui.js"),
      ]);
      const app = render(React.createElement(App, { session, initialSelection }), {
        exitOnCtrlC: false,
      });
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
      const status = await session.runSelected(filtered.selection, { exclude: filtered.exclude });
      reporter?.summary();
      if (session.lastRecord) {
        console.log(color(90, `run recorded in ${HISTORY_DIR}/runs/${session.lastRecord.id}`));
      }
      process.exitCode = session.runner!.interrupted ? 130 : status === "passed" ? 0 : 1;
    }
  });

await program.parseAsync(process.argv);
