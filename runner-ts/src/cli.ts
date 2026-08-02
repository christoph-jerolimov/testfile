#!/usr/bin/env node
import { existsSync, statSync, type FSWatcher } from "node:fs";
import { dirname, resolve } from "node:path";
import { Command } from "commander";
import { changedLeafIds, predictCacheHits } from "./cache-predict.js";
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
import { HISTORY_DIR } from "./history.js";
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
  changed: boolean;
}

// --changed narrows a resolved selection to the leaves that would actually
// execute (predicted cache misses).
async function applyChanged(
  session: Session,
  filtered: ReturnType<typeof resolveFilters>,
  changed: boolean
): Promise<ReturnType<typeof resolveFilters>> {
  if (!changed) return filtered;
  const leaves = await changedLeafIds(session, filtered.active);
  if (leaves.length === 0) {
    throw new Error("nothing changed — every selected test would be served from the cache");
  }
  return {
    selection: leaves,
    active: session.activeSetFor(leaves),
    leafCount: leaves.length,
    filtered: true,
  };
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
    .option("--failed", "only tests that failed in the last recorded run", false)
    .option("--changed", "only tests whose inputs changed (predicted cache misses)", false);
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
      console.log(color(90, "run it with: testfile run   (or testfile tui)"));
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
  .action(async (path: string, flags: FilterFlags) => {
    try {
      const { path: file, doc } = loadTestfile(path);
      const session = new Session(doc, dirname(file));
      let filtered = resolveFilters(session, flags);
      if (filtered.leafCount === 0) throw new Error("no tests match the given filters");
      filtered = await applyChanged(session, filtered, flags.changed);
      printTree(session, filtered.active);
    } catch (err) {
      console.error(`${color(31, "✘")} ${err instanceof Error ? err.message : err}`);
      process.exitCode = 1;
    }
  });

interface RunFlags extends FilterFlags {
  verbose: boolean;
  failFast: boolean;
  maxParallel?: number;
  dryRun: boolean;
  watch: boolean;
  cache: boolean;
  forwardEnv: string[];
  reporter?: ReporterKind;
  output: string;
}

addFilterOptions(
  program
    .command("run", { isDefault: true })
    .argument("[path]", "Testfile or directory containing one", ".")
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
    .option(
      "--forward-env <pattern>",
      'forward matching host env vars into the (isolated) test env, e.g. "GITHUB_*" or "*" (repeatable)',
      collect,
      []
    )
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
        forwardEnv: options.forwardEnv,
      });
      filtered = resolveFilters(session, options);
      if (filtered.leafCount === 0) throw new Error("no tests match the given filters");
      filtered = await applyChanged(session, filtered, options.changed);
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

    {
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
