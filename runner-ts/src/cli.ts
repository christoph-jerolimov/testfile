#!/usr/bin/env node
import { existsSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { Command } from "commander";
import {
  hasFilters,
  parseMatrixFilters,
  parseTagFilters,
  selectLeaves,
  splitGenericFilters,
  type TestFilters,
} from "./filter.js";
import { HISTORY_DIR, RunHistory, type RunRecord } from "./history.js";
import { loadTestfile } from "./loader.js";
import { ConsoleReporter } from "./reporter.js";
import { walk, type RunNode } from "./runtree.js";
import { Session } from "./session.js";
import { color, formatMs } from "./util.js";

const program = new Command();

const collect = (value: string, previous: string[]) => [...previous, value];

interface FilterFlags {
  filter: string[];
  filterName: string[];
  filterTags: string[];
  filterMatrix: string[];
}

// Turns the filter flags into the selection Session.runSelected expects,
// plus the resulting active set for display.
function resolveFilters(
  session: Session,
  flags: FilterFlags
): { selection: number[]; active: Set<number>; leafCount: number; filtered: boolean } {
  const generic = splitGenericFilters(flags.filter);
  const filters: TestFilters = {
    any: generic.nameOrTag,
    names: flags.filterName,
    tags: parseTagFilters(flags.filterTags),
    matrix: parseMatrixFilters([...flags.filterMatrix, ...generic.matrixSpecs]),
  };
  if (!hasFilters(filters)) {
    const active = session.activeSetFor([session.tree.id]);
    let leafCount = 0;
    for (const id of active) {
      if (session.byId.get(id)?.children.length === 0) leafCount++;
    }
    return { selection: [session.tree.id], active, leafCount, filtered: false };
  }
  const leaves = selectLeaves(session.tree, filters);
  const selection = leaves.map((leaf) => leaf.id);
  return { selection, active: session.activeSetFor(selection), leafCount: leaves.length, filtered: true };
}

function addFilterOptions(command: Command): Command {
  return command
    .option("-f, --filter <value>", "only tests matching by name/path, tag, or key:value matrix (repeatable)", collect, [])
    .option("-n, --filter-name <name-or-path>", "only tests whose path contains this (repeatable)", collect, [])
    .option("-t, --filter-tags <tags>", "only tests tagged with any of these comma-separated tags (repeatable)", collect, [])
    .option("-m, --filter-matrix <key:value>", "only matrix instances with this value (repeatable)", collect, []);
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

addFilterOptions(
  program
    .command("list")
    .argument("[path]", "Testfile or directory containing one", ".")
    .description("Print the expanded test tree (including matrix instances)")
)
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
        // Matrix instances share their wrapper's def; print tags only once.
        const tags =
          node.def.tags && node.parent?.def !== node.def
            ? color(90, `[${node.def.tags.join(", ")}]`)
            : "";
        console.log(`${"  ".repeat(node.depth)}${node.name} ${tags} ${marker}`.replace(/ +$/, ""));
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

const STATUS_COLORS: Record<string, number> = {
  passed: 32,
  failed: 31,
  aborted: 35,
  skipped: 90,
};

function colorStatus(status: string): string {
  return color(STATUS_COLORS[status] ?? 0, status);
}

// History works directly on the .testfile folder, so it does not require a
// (still) valid Testfile.
function resolveHistoryBase(path: string): string {
  const p = resolve(path);
  return existsSync(p) && statSync(p).isFile() ? dirname(p) : p;
}

function summarizeTests(run: RunRecord): string {
  const counts = new Map<string, number>();
  for (const test of run.tests) counts.set(test.status, (counts.get(test.status) ?? 0) + 1);
  return (
    [...counts.entries()].map(([status, n]) => `${n} ${colorStatus(status)}`).join(", ") || "-"
  );
}

function stripAnsi(text: string): string {
  return text.replace(/\u001b\[[0-9;]*m/g, "");
}

function pad(text: string, width: number): string {
  return text + " ".repeat(Math.max(0, width - stripAnsi(text).length));
}

program
  .command("history")
  .argument("[path]", "Testfile or directory containing one", ".")
  .option("--run <id>", "show one recorded run (a unique id prefix is enough)")
  .option("--log [test-path]", "with --run: print the run's merged log, or a single test's log")
  .description("List or show recorded test runs")
  .action((path: string, options: { run?: string; log?: string | boolean }) => {
    const history = new RunHistory(resolveHistoryBase(path));
    if (history.runs.length === 0) {
      console.error(`no recorded runs in ${HISTORY_DIR}/`);
      process.exitCode = 1;
      return;
    }

    if (!options.run) {
      const rows = history.runs.map((run) => [
        run.id,
        run.startedAt.replace("T", " ").slice(0, 19),
        run.status,
        formatMs(run.durationMs),
        String(run.exitCode),
        summarizeTests(run),
      ]);
      const header = ["ID", "STARTED", "STATUS", "DURATION", "EXIT", "TESTS"];
      const widths = header.map((h, i) =>
        Math.max(h.length, ...rows.map((r) => stripAnsi(r[i]).length))
      );
      console.log(color(1, header.map((h, i) => pad(h, widths[i])).join("  ")));
      for (const row of rows) {
        row[2] = colorStatus(row[2]);
        console.log(row.map((cell, i) => pad(cell, widths[i])).join("  "));
      }
      return;
    }

    const run = history.find(options.run);
    if (!run) {
      console.error(`${color(31, "✘")} no recorded run matches "${options.run}"`);
      process.exitCode = 1;
      return;
    }

    if (options.log !== undefined) {
      const text =
        typeof options.log === "string"
          ? (() => {
              const test = run.tests.find((t) => t.path === options.log);
              return test ? history.readLog(run, test) : undefined;
            })()
          : history.readRunLog(run);
      if (text === undefined) {
        console.error(`${color(31, "✘")} no log found${typeof options.log === "string" ? ` for test "${options.log}"` : ""} in run ${run.id}`);
        process.exitCode = 1;
        return;
      }
      process.stdout.write(text);
      return;
    }

    console.log(`${color(1, `run ${run.id}`)}`);
    console.log(`started:   ${run.startedAt}`);
    console.log(`duration:  ${formatMs(run.durationMs)}`);
    console.log(`status:    ${colorStatus(run.status)} (exit code ${run.exitCode})`);
    console.log(`cancelled: ${run.cancelled ? "yes" : "no"}`);
    console.log(`selected:  ${run.selected.join(", ") || "-"}`);
    const env = Object.entries(run.env).map(([k, v]) => `${k}=${v}`).join(" ");
    if (env) console.log(`env:       ${env}`);
    const ports = Object.entries(run.ports).map(([k, v]) => `${k}=${v}`).join(" ");
    if (ports) console.log(`ports:     ${ports}`);
    console.log("tests:");
    for (const test of run.tests) {
      const duration = test.durationMs !== undefined ? ` (${formatMs(test.durationMs)})` : "";
      const log = test.log ? color(90, "  [log]") : "";
      console.log(`  ${pad(colorStatus(test.status), 7)} ${test.path}${duration}${log}`);
    }
    console.log(color(90, `\nlogs: testfile history --run ${run.id} --log [test-path]`));
  });

addFilterOptions(
  program
    .command("run", { isDefault: true })
    .argument("[path]", "Testfile or directory containing one", ".")
    .option("--tui", "interactive terminal UI", false)
    .option("-v, --verbose", "also stream service output", false)
    .description("Run the test tree")
)
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
      const initialSelection = filtered.filtered
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
      const status = await session.runSelected(filtered.selection);
      reporter?.summary();
      if (session.lastRecord) {
        console.log(color(90, `run recorded in ${HISTORY_DIR}/runs/${session.lastRecord.id}`));
      }
      process.exitCode = session.runner!.interrupted ? 130 : status === "passed" ? 0 : 1;
    }
  });

await program.parseAsync(process.argv);
