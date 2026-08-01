#!/usr/bin/env node
import { existsSync, statSync, type FSWatcher } from "node:fs";
import { dirname, resolve } from "node:path";
import { Command } from "commander";
import { predictCacheHits } from "./cache-predict.js";
import { generateCompletion, type CompletionModel } from "./completion.js";
import {
  filterByLastFailed,
  hasFilters,
  parseMatrixFilters,
  parseTagFilters,
  selectLeaves,
  splitGenericFilters,
  type TestFilters,
} from "./filter.js";
import { detectFlaky, diffRuns, HISTORY_DIR, RunHistory, type RunRecord } from "./history.js";
import { initTestfile } from "./init.js";
import { loadTestfile } from "./loader.js";
import { writeReport, type ReporterKind } from "./report.js";
import { ConsoleReporter } from "./reporter.js";
import { walk, type RunNode } from "./runtree.js";
import { Session } from "./session.js";
import { color, formatMs } from "./util.js";
import { watchDirectory, WatchScheduler } from "./watch.js";

const program = new Command();

const collect = (value: string, previous: string[]) => [...previous, value];

interface FilterFlags {
  filter: string[];
  filterName: string[];
  filterTags: string[];
  filterMatrix: string[];
  failed: boolean;
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
  if (!hasFilters(filters) && !flags.failed) {
    const active = session.activeSetFor([session.tree.id]);
    let leafCount = 0;
    for (const id of active) {
      if (session.byId.get(id)?.children.length === 0) leafCount++;
    }
    return { selection: [session.tree.id], active, leafCount, filtered: false };
  }
  let leaves = selectLeaves(session.tree, filters);
  if (flags.failed) {
    leaves = filterByLastFailed(leaves, session.history.runs[0]);
    if (leaves.length === 0) throw new Error("nothing failed in the last recorded run");
  }
  const selection = leaves.map((leaf) => leaf.id);
  return { selection, active: session.activeSetFor(selection), leafCount: leaves.length, filtered: true };
}

// Shared by `list` and `run --dry-run`.
function printTree(session: Session, active: Set<number>, annotate?: (node: RunNode) => string): void {
  for (const [name] of Object.entries(session.doc.services ?? {})) {
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
    const extra = annotate?.(node) ?? "";
    console.log(`${"  ".repeat(node.depth)}${node.name} ${tags} ${marker}${extra}`.replace(/ +$/, ""));
    for (const [name] of Object.entries(node.def.services ?? {})) {
      if (!node.isMatrixWrapper) {
        console.log(`${"  ".repeat(node.depth + 1)}${color(36, "◆")} service ${name}`);
      }
    }
  });
}

function addFilterOptions(command: Command): Command {
  return command
    .option("-f, --filter <value>", "only tests matching by name/path, tag, or key:value matrix (repeatable)", collect, [])
    .option("-n, --filter-name <name-or-path>", "only tests whose path contains this (repeatable)", collect, [])
    .option("-t, --filter-tags <tags>", "only tests tagged with any of these comma-separated tags (repeatable)", collect, [])
    .option("-m, --filter-matrix <key:value>", "only matrix instances with this value (repeatable)", collect, [])
    .option("--failed", "only tests that failed in the last recorded run", false);
}

program
  .name("testfile")
  .description("Run the tests described in a Testfile / testfile.yaml")
  .version("0.1.0");

program
  .command("init")
  .argument("[path]", "directory to create the Testfile in", ".")
  .description("Create a starter Testfile (from package.json scripts when present)")
  .action((path: string) => {
    try {
      const { path: file, content } = initTestfile(path);
      console.log(content);
      console.log(`${color(32, "✔")} wrote ${file}`);
      console.log(color(90, "run it with: testfile run   (or testfile run --tui)"));
    } catch (err) {
      console.error(`${color(31, "✘")} ${err instanceof Error ? err.message : err}`);
      process.exitCode = 1;
    }
  });

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
      printTree(session, active);
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
  .option("--diff <ids...>", "compare two recorded runs (older id first)")
  .option("--flaky", "find tests that both passed and failed across recorded runs", false)
  .option("--last <n>", "with --flaky: only consider the most recent n runs", (v: string) =>
    Number.parseInt(v, 10)
  )
  .description("List, show or compare recorded test runs")
  .action(
    (
      path: string,
      options: { run?: string; log?: string | boolean; diff?: string[]; flaky: boolean; last?: number }
    ) => {
    const history = new RunHistory(resolveHistoryBase(path));
    if (history.runs.length === 0) {
      console.error(`no recorded runs in ${HISTORY_DIR}/`);
      process.exitCode = 1;
      return;
    }

    if (options.flaky) {
      const considered =
        options.last !== undefined ? Math.min(options.last, history.runs.length) : history.runs.length;
      const reports = detectFlaky(history.runs, options.last);
      if (reports.length === 0) {
        console.log(`no flaky tests detected across ${considered} run${considered === 1 ? "" : "s"}`);
        return;
      }
      console.log(color(1, `flaky tests across ${considered} run${considered === 1 ? "" : "s"}:`));
      for (const report of reports) {
        const rate = `${report.fails}/${report.occurrences} failed`;
        const flips = `${report.flips} flip${report.flips === 1 ? "" : "s"}`;
        const last = `last ${colorStatus(report.lastStatus)}`;
        console.log(`  ${pad(color(33, report.path), 40)} ${rate}, ${flips}, ${last}`);
      }
      console.log(
        color(90, '\nconsider tagging these tests [flaky] and adding "retry" (see docs/writing-tests)')
      );
      return;
    }

    if (options.diff) {
      if (options.diff.length !== 2) {
        console.error(`${color(31, "✘")} --diff needs exactly two run ids`);
        process.exitCode = 1;
        return;
      }
      const [base, compare] = options.diff.map((id) => history.find(id));
      const missing = options.diff.filter((_, i) => (i === 0 ? !base : !compare));
      if (!base || !compare) {
        console.error(`${color(31, "✘")} no recorded run matches "${missing[0]}"`);
        process.exitCode = 1;
        return;
      }
      const diff = diffRuns(base, compare);
      console.log(color(1, `${base.id} -> ${compare.id}`));
      const section = (label: string, code: number, paths: string[]): void => {
        for (const p of paths) console.log(`  ${pad(color(code, label), 13)} ${p}`);
      };
      section("newly failed", 31, diff.newlyFailed);
      section("fixed", 32, diff.fixed);
      section("still failing", 33, diff.stillFailing);
      section("added", 36, diff.added);
      section("removed", 90, diff.removed);
      for (const d of diff.durations) {
        const arrow = d.toMs > d.fromMs ? color(33, "slower") : color(32, "faster");
        console.log(`  ${pad(arrow, 13)} ${d.path} (${formatMs(d.fromMs)} -> ${formatMs(d.toMs)})`);
      }
      const total =
        diff.newlyFailed.length + diff.fixed.length + diff.stillFailing.length +
        diff.added.length + diff.removed.length + diff.durations.length;
      if (total === 0) console.log(color(90, "  no differences"));
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
      const artifacts = test.artifacts?.length
        ? color(90, `  [${test.artifacts.length} artifact${test.artifacts.length === 1 ? "" : "s"}]`)
        : "";
      const cached = test.cached ? color(90, "  [cached]") : "";
      console.log(`  ${pad(colorStatus(test.status), 7)} ${test.path}${duration}${log}${artifacts}${cached}`);
    }
    console.log(color(90, `\nlogs: testfile history --run ${run.id} --log [test-path]`));
  });

interface RunFlags extends FilterFlags {
  tui: boolean;
  verbose: boolean;
  failFast: boolean;
  maxParallel?: number;
  dryRun: boolean;
  watch: boolean;
  cache: boolean;
  reporter?: ReporterKind;
  output: string;
}

addFilterOptions(
  program
    .command("run", { isDefault: true })
    .argument("[path]", "Testfile or directory containing one", ".")
    .option("--tui", "interactive terminal UI", false)
    .option("-v, --verbose", "also stream service output", false)
    .option("--fail-fast", "abort the whole run at the first test failure", false)
    .option(
      "--max-parallel <n>",
      "global cap on concurrently running tests",
      (value: string) => Number.parseInt(value, 10),
      undefined
    )
    .option("--dry-run", "print what would run (with filters applied) without running", false)
    .option("-w, --watch", "re-run the selection when files change", false)
    .option("--no-cache", "ignore cached results (fresh results still refresh the cache)")
    .option("--reporter <kind>", "write machine-readable results after the run: junit or json")
    .option("--output <file>", 'report target file, or "-" for stdout', "-")
    .description("Run the test tree")
)
  .action(async (path: string, options: RunFlags) => {
    let session: Session;
    let filtered: ReturnType<typeof resolveFilters>;
    try {
      if (options.maxParallel !== undefined && !(options.maxParallel >= 1)) {
        throw new Error("--max-parallel must be a positive integer");
      }
      if (options.reporter !== undefined && options.reporter !== "junit" && options.reporter !== "json") {
        throw new Error(`unknown --reporter "${options.reporter}", expected junit or json`);
      }
      const { path: file, doc } = loadTestfile(path);
      session = new Session(doc, dirname(file), {
        failFast: options.failFast,
        maxParallel: options.maxParallel,
        noCache: !options.cache,
      });
      filtered = resolveFilters(session, options);
      if (filtered.leafCount === 0) throw new Error("no tests match the given filters");
    } catch (err) {
      console.error(`${color(31, "✘")} ${err instanceof Error ? err.message : err}`);
      process.exitCode = 1;
      return;
    }

    if (options.dryRun) {
      const hits = await predictCacheHits(session, filtered.active);
      printTree(session, filtered.active, (node) =>
        hits.has(node.id) ? ` ${color(90, "[cached]")}` : ""
      );
      const fresh = filtered.leafCount - hits.size;
      console.log(
        color(
          90,
          `\n${fresh} test${fresh === 1 ? "" : "s"} would run` +
            (hits.size > 0 ? `, ${hits.size} served from the cache` : "")
        )
      );
      return;
    }

    // Watch mode: re-run the last selection when files change (debounced;
    // changes during a run re-trigger once it finished).
    let scheduler: WatchScheduler | undefined;
    let watcher: FSWatcher | undefined;
    const startWatching = (rerun: () => void): void => {
      if (!options.watch) return;
      scheduler = new WatchScheduler({
        debounceMs: 300,
        isRunning: () => session.running,
        trigger: rerun,
      });
      watcher = watchDirectory(session.baseDir, () => scheduler?.notify());
      session.on("update", () => {
        if (!session.running) scheduler?.runFinished();
      });
    };
    const stopWatching = (): void => {
      scheduler?.close();
      watcher?.close();
    };

    let interrupts = 0;
    const onSignal = () => {
      interrupts += 1;
      if (!session.running || !session.runner) {
        // idle (e.g. waiting in watch mode): exit with the last run's code
        process.exit(typeof process.exitCode === "number" ? process.exitCode : 130);
      } else if (interrupts === 1) {
        console.error("\nstopping gracefully (Ctrl+C again to force)...");
        stopWatching();
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
      startWatching(() => {
        void session.runSelected(
          session.lastSelection ??
            (initialSelection.length > 0 ? initialSelection : [session.tree.id])
        );
      });
      await app.waitUntilExit();
      stopWatching();
      if (options.reporter && session.lastRecord) {
        writeReport(session, options.reporter, options.output);
        if (options.output !== "-") console.log(color(90, `${options.reporter} report written to ${options.output}`));
      }
      const status = session.runner?.root.status;
      process.exitCode =
        session.runner === undefined
          ? 0
          : session.runner.interrupted
            ? 130
            : status === "passed" || status === "skipped"
              ? 0
              : 1;
    } else {
      if (options.tui) console.error("not a TTY, falling back to plain output");
      process.on("SIGINT", onSignal);
      let reporter: ConsoleReporter | undefined;
      session.on("runner", (runner) => {
        reporter = new ConsoleReporter(runner, { verbose: options.verbose });
      });
      const runOnce = async (): Promise<void> => {
        const status = await session.runSelected(filtered.selection);
        if (status === undefined) return;
        reporter?.summary();
        if (session.lastRecord) {
          console.log(color(90, `run recorded in ${HISTORY_DIR}/runs/${session.lastRecord.id}`));
        }
        if (options.reporter) {
          writeReport(session, options.reporter, options.output);
          if (options.output !== "-") console.log(color(90, `${options.reporter} report written to ${options.output}`));
        }
        process.exitCode =
          session.runner!.interrupted ? 130 : status === "passed" || status === "skipped" ? 0 : 1;
      };
      await runOnce();
      if (options.watch && !session.runner?.interrupted) {
        startWatching(() => {
          console.log(color(36, "\nchange detected, re-running..."));
          void runOnce();
        });
        console.log(color(36, "watching for changes... (Ctrl+C to exit)"));
      }
    }
  });

program
  .command("completion")
  .argument("<shell>", "bash, zsh or fish")
  .description("Print a shell completion script")
  .action((shell: string) => {
    try {
      const model: CompletionModel = {
        program: "testfile",
        commands: program.commands
          .filter((command) => command.name() !== "completion")
          .map((command) => ({
            name: command.name(),
            description: command.description(),
            flags: command.options.flatMap((option) =>
              option.flags
                .split(/[,\s]+/)
                .filter((part) => part.startsWith("-"))
            ),
          })),
      };
      process.stdout.write(generateCompletion(model, shell));
    } catch (err) {
      console.error(`${color(31, "✘")} ${err instanceof Error ? err.message : err}`);
      process.exitCode = 1;
    }
  });

await program.parseAsync(process.argv);
