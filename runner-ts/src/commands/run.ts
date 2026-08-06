import { type FSWatcher } from "node:fs";
import { dirname } from "node:path";
import type { Command } from "commander";
import { HISTORY_DIR } from "../history.js";
import { loadTestfile } from "../loader.js";
import { writeReport, type ReporterKind } from "../report.js";
import { ConsoleReporter } from "../reporter.js";
import { Session } from "../session.js";
import { color } from "../util.js";
import { watchDirectory, WatchScheduler } from "../watch.js";
import {
  addFilterOptions,
  applyChanged,
  applyShard,
  collect,
  predictCacheHits,
  printSuite,
  resolveFilters,
  type FilterFlags,
} from "./shared.js";

// "branch=main" pairs into a map, split at the first "=" so a value may
// contain more. A key may only be given once: silently keeping one of two
// values for the same key would record something nobody asked for.
export function parseLabels(pairs: string[]): Record<string, string> {
  const labels: Record<string, string> = {};
  for (const pair of pairs) {
    const at = pair.indexOf("=");
    if (at <= 0) throw new Error(`--label expects key=value, got "${pair}"`);
    const key = pair.slice(0, at).trim();
    if (key === "") throw new Error(`--label expects key=value, got "${pair}"`);
    if (key in labels) throw new Error(`--label ${key} was given twice`);
    labels[key] = pair.slice(at + 1).trim();
  }
  return labels;
}

// "platform=linux" pairs into a map, in the order they were given.
export function parseVariants(pairs: string[]): Record<string, string> {
  const variants: Record<string, string> = {};
  for (const pair of pairs) {
    const at = pair.indexOf("=");
    if (at <= 0) throw new Error(`--variant expects key=value, got "${pair}"`);
    variants[pair.slice(0, at).trim()] = pair.slice(at + 1).trim();
  }
  return variants;
}

export function registerRun(program: Command): void {
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
    variant: string[];
    label: string[];
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
        undefined,
      )
      .option("--dry-run", "print what would run (with filters applied) without running", false)
      .option("-w, --watch", "re-run the selection when files change", false)
      .option("--no-cache", "ignore cached results (fresh results still refresh the cache)")
      .option(
        "--forward-env <pattern>",
        'forward matching host env vars into the (isolated) test env, e.g. "GITHUB_*" or "*" (repeatable)',
        collect,
        [],
      )
      .option(
        "--variant <key=value>",
        "record what distinguishes this run from a sibling run, e.g. platform=linux (repeatable)",
        collect,
        [],
      )
      .option(
        "-l, --label <key=value>",
        "record a label with the run, e.g. branch=main, to find it again later (repeatable)",
        collect,
        [],
      )
      .option("--reporter <kind>", "write machine-readable results after the run: junit or json")
      .option("--output <file>", 'report target file, or "-" for stdout', "-")
      .description("Run the test suite"),
  ).action(async (path: string, options: RunFlags) => {
    let session: Session;
    let filtered: ReturnType<typeof resolveFilters>;
    try {
      if (options.maxParallel !== undefined && !(options.maxParallel >= 1)) {
        throw new Error("--max-parallel must be a positive integer");
      }
      if (
        options.reporter !== undefined &&
        options.reporter !== "junit" &&
        options.reporter !== "json"
      ) {
        throw new Error(`unknown --reporter "${options.reporter}", expected junit or json`);
      }
      const { path: file, doc } = loadTestfile(path);
      session = new Session(doc, dirname(file), {
        failFast: options.failFast,
        maxParallel: options.maxParallel,
        noCache: !options.cache,
        forwardEnv: options.forwardEnv,
        variants: parseVariants(options.variant),
        labels: parseLabels(options.label),
      });
      filtered = resolveFilters(session, options);
      if (filtered.testCount === 0) throw new Error("no tests match the given filters");
      filtered = await applyChanged(session, filtered, options);
      filtered = applyShard(session, filtered, options.shard);
    } catch (err) {
      console.error(`${color(31, "✘")} ${err instanceof Error ? err.message : err}`);
      process.exitCode = 1;
      return;
    }

    if (options.dryRun) {
      const hits = await predictCacheHits(session, filtered.active);
      printSuite(session, filtered.active, (test) =>
        hits.has(test.id) ? ` ${color(90, "[cached]")}` : "",
      );
      const fresh = filtered.testCount - hits.size;
      console.log(
        color(
          90,
          `\n${fresh} test${fresh === 1 ? "" : "s"} would run` +
            (hits.size > 0 ? `, ${hits.size} served from the cache` : ""),
        ),
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
          if (options.output !== "-")
            console.log(color(90, `${options.reporter} report written to ${options.output}`));
        }
        process.exitCode = session.runner!.interrupted
          ? 130
          : status === "passed" || status === "skipped"
            ? 0
            : 1;
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
}
