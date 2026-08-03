#!/usr/bin/env node
import { existsSync, statSync, type FSWatcher } from "node:fs";
import { dirname, resolve } from "node:path";
import { writeFileSync } from "node:fs";
import { Command } from "commander";
import { gitChangedSelection, predictCacheHits } from "./cache-predict.js";
import { generateCompletion, type CompletionModel } from "./completion.js";
import { durationsFrom, parseShard, selectShard } from "./shard.js";
import { collectGitChanges } from "./gitchanges.js";
import {
  filterByLastFailed,
  hasFilters,
  parseMatrixFilters,
  parseTagFilters,
  selectTests,
  splitGenericFilters,
  type TestFilters,
} from "./filter.js";
import { HISTORY_DIR } from "./history.js";
import { initTestfile } from "./init.js";
import { loadTestfile } from "./loader.js";
import { writeReport, type ReporterKind } from "./report.js";
import { ConsoleReporter } from "./reporter.js";
import { walk, type RunTest } from "./runsuite.js";
import { Session } from "./session.js";
import { collectTags, sortTags } from "./tags.js";
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
  changedSince?: string;
  shard?: string;
}

// --changed narrows a resolved selection to the tests whose `inputs` match
// a file changed against the base branch (committed or dirty in the working
// copy); tests without `inputs` always count as changed. Needs a git
// checkout - see the `changes` command to inspect what it selects from.
async function applyChanged(
  session: Session,
  filtered: ReturnType<typeof resolveFilters>,
  flags: Pick<FilterFlags, "changed" | "changedSince">
): Promise<ReturnType<typeof resolveFilters>> {
  if (!flags.changed && flags.changedSince === undefined) return filtered;
  const changes = collectGitChanges(session.baseDir, flags.changedSince);
  const { ids, notes } = await gitChangedSelection(session, filtered.active, changes);
  if (ids.length === 0) {
    throw new Error(
      `nothing to run: no selected test has inputs matching the ` +
        `${changes.files.length} changed file${changes.files.length === 1 ? "" : "s"} ` +
        `against ${changes.baseRef} (see: testfile changes)`
    );
  }
  session.selectionNotes = notes;
  console.log(
    color(
      90,
      `--changed: ${ids.length} of ${filtered.testCount} tests selected ` +
        `(${changes.files.length} files changed against ${changes.baseRef})`
    )
  );
  return {
    selection: ids,
    active: session.activeSetFor(ids),
    testCount: ids.length,
    filtered: true,
  };
}

// --shard i/n keeps only this shard's share of the selected leaf tests.
// Every shard computes the same split from the same suite, so no
// coordination is needed; recorded durations make it time-balanced.
function applyShard(
  session: Session,
  filtered: ReturnType<typeof resolveFilters>,
  spec: string | undefined
): ReturnType<typeof resolveFilters> {
  if (spec === undefined) return filtered;
  const shard = parseShard(spec);
  const leaves: { id: number; path: string }[] = [];
  walk(session.suite, (test) => {
    if (filtered.active.has(test.id) && test.children.length === 0) {
      leaves.push({ id: test.id, path: test.path });
    }
  });
  const durations = durationsFrom(session.history.runs);
  const result = selectShard(leaves, shard, durations);
  if (result.ids.length === 0) {
    throw new Error(
      `--shard ${shard.index}/${shard.total} selects no tests (only ${leaves.length} to distribute)`
    );
  }
  console.log(
    color(
      90,
      `shard ${shard.index}/${shard.total}: ${result.ids.length} of ${leaves.length} tests` +
        (result.balanced ? `, ~${formatMs(result.estimateMs ?? 0)} of recorded work` : "")
    )
  );
  return {
    selection: result.ids,
    active: session.activeSetFor(result.ids),
    testCount: result.ids.length,
    filtered: true,
  };
}

// Turns the filter flags into the selection Session.runSelected expects,
// plus the resulting active set for display.
function resolveFilters(
  session: Session,
  flags: FilterFlags
): { selection: number[]; active: Set<number>; testCount: number; filtered: boolean } {
  const generic = splitGenericFilters(flags.filter);
  const filters: TestFilters = {
    any: generic.nameOrTag,
    names: flags.filterName,
    tags: parseTagFilters(flags.filterTags),
    matrix: parseMatrixFilters([...flags.filterMatrix, ...generic.matrixSpecs]),
  };
  if (!hasFilters(filters) && !flags.failed) {
    const active = session.activeSetFor([session.suite.id]);
    let testCount = 0;
    for (const id of active) {
      if (session.byId.get(id)?.children.length === 0) testCount++;
    }
    return { selection: [session.suite.id], active, testCount, filtered: false };
  }
  let tests = selectTests(session.suite, filters);
  if (flags.failed) {
    tests = filterByLastFailed(tests, session.history.runs[0]);
    if (tests.length === 0) throw new Error("nothing failed in the last recorded run");
  }
  const selection = tests.map((test) => test.id);
  return { selection, active: session.activeSetFor(selection), testCount: tests.length, filtered: true };
}

// Shared by `list` and `run --dry-run`.
function printSuite(session: Session, active: Set<number>, annotate?: (test: RunTest) => string): void {
  for (const [name] of Object.entries(session.doc.services ?? {})) {
    console.log(`${color(36, "◆")} service ${name}`);
  }
  walk(session.suite, (test: RunTest) => {
    if (!active.has(test.id)) return;
    const marker = test.children.length > 0 ? color(90, test.kind) : "";
    // Matrix instances share their wrapper's def; print tags only once.
    const tags =
      test.def.tags && test.parent?.def !== test.def
        ? color(90, `[${test.def.tags.join(", ")}]`)
        : "";
    const extra = annotate?.(test) ?? "";
    console.log(`${"  ".repeat(test.depth)}${test.name} ${tags} ${marker}${extra}`.replace(/ +$/, ""));
    for (const [name] of Object.entries(test.def.services ?? {})) {
      if (!test.isMatrixWrapper) {
        console.log(`${"  ".repeat(test.depth + 1)}${color(36, "◆")} service ${name}`);
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
    .option("--changed", "only tests whose inputs match files changed against the base branch (plus local changes)", false)
    .option("--changed-since <ref>", "base branch/ref for --changed, e.g. origin/main (implies --changed)")
    .option(
      "--shard <i/n>",
      "run only this shard of the selected tests, e.g. 2/4 (time-balanced from the run history)"
    );
}

program
  .name("testfile")
  .description("Run the tests described in a Testfile / testfile.yaml")
  .version("0.1.0");

program
  .command("init")
  .argument("[path]", "directory to create the Testfile in", ".")
  .option(
    "--from <file>",
    "import from a docker-compose file, GitHub workflow, Makefile, Taskfile or justfile (repeatable)",
    collect,
    []
  )
  .option("--no-detect", "do not look for importable files automatically")
  .description(
    "Create a starter Testfile from package.json scripts, docker-compose files, workflows, Makefiles"
  )
  .action((path: string, options: { from: string[]; detect: boolean }) => {
    try {
      const sources = options.from.length > 0 ? options.from.map((file) => resolve(file)) : undefined;
      const { path: file, content, imported, notes } = initTestfile(path, {
        sources,
        detect: options.detect,
      });
      console.log(content);
      console.log(`${color(32, "✔")} wrote ${file}`);
      if (imported.length > 0) console.log(color(90, `imported from: ${imported.join(", ")}`));
      for (const note of notes) console.log(color(33, `! ${note}`));
      console.log(color(90, "run it with: testfile run   (or testfile-viewer tui)"));
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
    .description("Print the expanded test suite (including matrix instances)")
)
  .action(async (path: string, flags: FilterFlags) => {
    try {
      const { path: file, doc } = loadTestfile(path);
      const session = new Session(doc, dirname(file));
      let filtered = resolveFilters(session, flags);
      if (filtered.testCount === 0) throw new Error("no tests match the given filters");
      filtered = await applyChanged(session, filtered, flags);
      filtered = applyShard(session, filtered, flags.shard);
      printSuite(session, filtered.active);
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
    .description("Run the test suite")
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
        hits.has(test.id) ? ` ${color(90, "[cached]")}` : ""
      );
      const fresh = filtered.testCount - hits.size;
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
  .command("tags")
  .argument("[path]", "Testfile or directory containing one", ".")
  .option("--order <order>", "alpha (default), appearance (document order) or count", "alpha")
  .option("--json [file]", "write the tags as JSON, to a file or (without a value) stdout")
  .description("List all tags of the full test suite (including included Testfiles)")
  .action((path: string, options: { order: string; json?: string | boolean }) => {
    try {
      if (options.order !== "alpha" && options.order !== "appearance" && options.order !== "count") {
        throw new Error(`unknown --order "${options.order}", expected alpha, appearance or count`);
      }
      const { path: file, doc } = loadTestfile(path);
      const session = new Session(doc, dirname(file));
      const summary = collectTags(session.suite);
      const tags = sortTags(summary.tags, options.order);

      if (options.json !== undefined && options.json !== false) {
        const json = `${JSON.stringify(
          {
            order: options.order,
            tags: tags.map(({ name, count, appearance }) => ({ name, count, appearance })),
            untagged: summary.untagged,
            tests: summary.tests,
          },
          null,
          2
        )}\n`;
        if (typeof options.json === "string") {
          writeFileSync(options.json, json);
          console.log(color(90, `tags written to ${options.json}`));
        } else {
          process.stdout.write(json);
        }
        return;
      }

      if (tags.length === 0 && options.order !== "count") {
        console.log(color(90, "no tags declared"));
        return;
      }
      if (options.order === "count") {
        const width = Math.max(...tags.map((tag) => String(tag.count).length), 1);
        for (const tag of tags) console.log(`${String(tag.count).padStart(width)}  ${tag.name}`);
        console.log(
          color(
            90,
            `${tags.length > 0 ? "\n" : ""}${summary.tests} test${summary.tests === 1 ? "" : "s"}, ` +
              `${summary.untagged} without any tag`
          )
        );
      } else {
        for (const tag of tags) console.log(tag.name);
      }
    } catch (err) {
      console.error(`${color(31, "✘")} ${err instanceof Error ? err.message : err}`);
      process.exitCode = 1;
    }
  });

program
  .command("changes")
  .argument("[path]", "directory (or Testfile) whose git repository to inspect", ".")
  .option("--changed-since <ref>", "base branch/ref to diff against (default: auto-detected)")
  .option("--files", "print only the file paths, one per line", false)
  .option("--json [file]", "write the changes as JSON, to a file or (without a value) stdout")
  .description("Show the files changed against the base branch - what --changed selects tests from")
  .action((path: string, options: { changedSince?: string; files: boolean; json?: string | boolean }) => {
    try {
      const target = resolve(path);
      const dir = existsSync(target) && statSync(target).isDirectory() ? target : dirname(target);
      const changes = collectGitChanges(dir, options.changedSince);

      if (options.json !== undefined && options.json !== false) {
        const json = `${JSON.stringify(changes, null, 2)}\n`;
        if (typeof options.json === "string") {
          writeFileSync(options.json, json);
          console.log(color(90, `changes written to ${options.json}`));
        } else {
          process.stdout.write(json);
        }
        return;
      }
      if (options.files) {
        for (const file of changes.files) console.log(file.path);
        return;
      }

      console.log(`base:  ${changes.baseRef} (${changes.baseCommit.slice(0, 9)})`);
      console.log(`head:  ${changes.headCommit?.slice(0, 9) ?? "(no commits yet)"}`);
      console.log(`root:  ${changes.gitRoot}`);
      console.log("");
      if (changes.files.length === 0) {
        console.log(color(90, "no changes"));
        return;
      }
      const width = Math.max(...changes.files.map((file) => file.path.length), 4);
      console.log(color(90, `${"file".padEnd(width)}  source  status`));
      for (const file of changes.files) {
        console.log(`${file.path.padEnd(width)}  ${file.source.padEnd(6)}  ${file.status}`);
      }
      console.log(
        color(90, `\n${changes.files.length} changed file${changes.files.length === 1 ? "" : "s"}`)
      );
    } catch (err) {
      console.error(`${color(31, "✘")} ${err instanceof Error ? err.message : err}`);
      process.exitCode = 1;
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
