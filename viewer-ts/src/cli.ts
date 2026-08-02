#!/usr/bin/env node
// The read-only companion of the `testfile` runner: everything here works
// on the recorded runs in .testfile/ and never touches the Testfile or
// starts processes.
import { existsSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { Command } from "commander";
import { detectFlaky, diffRuns, HISTORY_DIR, RunHistory, type RunRecord } from "./runrecord.js";
import { findViewerDir, ViewerServer } from "./serve.js";
import { importRunArchive, packRun, s3Pull, s3Push, syncFromGithub } from "./transfer.js";
import { color, formatMs, pad } from "./util.js";

const program = new Command();

program
  .name("testfile-viewer")
  .description("Inspect, browse and share recorded Testfile runs (read-only)")
  .version("0.1.0");

const STATUS_COLORS: Record<string, number> = {
  passed: 32,
  failed: 31,
  aborted: 35,
  skipped: 90,
};

function colorStatus(status: string): string {
  return color(STATUS_COLORS[status] ?? 0, status);
}

// Everything works directly on the .testfile folder; a path may point at a
// Testfile, its directory, or any directory containing .testfile/.
function resolveHistoryBase(path: string): string {
  const p = resolve(path);
  return existsSync(p) && statSync(p).isFile() ? dirname(p) : p;
}

function commandFailed(err: unknown): void {
  console.error(`${color(31, "✘")} ${err instanceof Error ? err.message : err}`);
  process.exitCode = 1;
}

function summarizeTests(run: RunRecord): string {
  const counts = new Map<string, number>();
  for (const test of run.tests) counts.set(test.status, (counts.get(test.status) ?? 0) + 1);
  return (
    [...counts.entries()].map(([status, n]) => `${n} ${colorStatus(status)}`).join(", ") || "-"
  );
}

program
  .command("history", { isDefault: true })
  .argument("[path]", "directory containing a .testfile folder", ".")
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
        console.log(color(90, '\nconsider tagging these tests [flaky] and adding "retry"'));
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
        const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => pad(r[i], 0).length)));
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
          console.error(
            `${color(31, "✘")} no log found${typeof options.log === "string" ? ` for test "${options.log}"` : ""} in run ${run.id}`
          );
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
      if (run.services?.length) {
        console.log("services:");
        for (const service of run.services) {
          const log = service.log ? color(90, "  [log]") : "";
          console.log(`  ${pad(service.status ?? "-", 7)} ${service.name}${log}`);
        }
      }
      console.log(color(90, `\nlogs: testfile-viewer history --run ${run.id} --log [test-path]`));
    }
  );

program
  .command("tui")
  .argument("[path]", "directory containing a .testfile folder", ".")
  .option("--view <view>", "initial view: runs or results", "runs")
  .option("--name <name>", "display name shown in the header")
  .description("Interactive terminal UI over the recorded runs (watches for new runs)")
  .action(async (path: string, options: { view: string; name?: string }) => {
    try {
      if (!process.stdout.isTTY) {
        throw new Error("the TUI needs an interactive terminal (use: testfile-viewer history)");
      }
      if (options.view !== "runs" && options.view !== "results") {
        throw new Error(`unknown --view "${options.view}", expected runs or results`);
      }
      const base = resolveHistoryBase(path);
      const history = new RunHistory(base);
      const { startTui } = await import("./tui/index.js");
      const tui = startTui(history, {
        baseDir: base,
        name: options.name,
        view: options.view as "runs" | "results",
      });
      await tui.waitUntilExit();
    } catch (err) {
      commandFailed(err);
    }
  });

program
  .command("serve")
  .argument("[path]", "directory containing a .testfile folder", ".")
  .option(
    "--port <n>",
    "port to listen on (always bound to 127.0.0.1 only)",
    (value: string) => Number.parseInt(value, 10),
    7357
  )
  .option("--name <name>", "display name shown in the web viewer")
  .description("Serve a localhost REST API and web viewer over the recorded runs")
  .action(async (path: string, options: { port: number; name?: string }) => {
    try {
      if (!(options.port >= 0 && options.port <= 65535)) {
        throw new Error("--port must be between 0 and 65535");
      }
      const base = resolveHistoryBase(path);
      const viewerDir = findViewerDir();
      const server = new ViewerServer({ baseDir: base, port: options.port, name: options.name, viewerDir });
      const port = await server.start();
      console.log(`${color(32, "●")} serving on http://127.0.0.1:${port} (Ctrl+C to stop)`);
      if (!viewerDir) {
        console.log(
          color(90, "web viewer not built — REST API only (npm run build --workspace viewer-web)")
        );
      }
      const shutdown = (): void => {
        server.close();
        process.exit(0);
      };
      process.on("SIGINT", shutdown);
      process.on("SIGTERM", shutdown);
    } catch (err) {
      commandFailed(err);
    }
  });

// --- testfile-viewer runs: pack, share and sync recorded runs -------------

const runsCommand = program
  .command("runs")
  .description("Pack, share and sync recorded runs (inspect them with: history)");

// The run to operate on: an id prefix when given, the latest run otherwise.
function pickRun(base: string, idOrPrefix: string | undefined): RunRecord {
  const history = new RunHistory(base);
  if (idOrPrefix !== undefined) {
    const run = history.find(idOrPrefix);
    if (!run) throw new Error(`no recorded run matches "${idOrPrefix}"`);
    return run;
  }
  const run = history.runs[0];
  if (!run) throw new Error(`no recorded runs in ${HISTORY_DIR}/`);
  return run;
}

function reportImport(result: { imported: string[]; skipped: string[] }): void {
  for (const id of result.imported) console.log(`${color(32, "✔")} imported run ${id}`);
  for (const id of result.skipped) {
    console.log(color(90, `- run ${id} already exists locally, skipped`));
  }
}

runsCommand
  .command("pack")
  .argument("[path]", "directory containing a .testfile folder", ".")
  .option("--run <id>", "run to pack, id prefix is enough (default: the latest run)")
  .option("-o, --output <file>", "target file (default: testfile-run-<id>.tgz)")
  .description("Pack a recorded run as a .tgz archive")
  .action((path: string, options: { run?: string; output?: string }) => {
    try {
      const base = resolveHistoryBase(path);
      const run = pickRun(base, options.run);
      const out = options.output ?? `testfile-run-${run.id}.tgz`;
      packRun(base, run.id, out);
      console.log(`${color(32, "✔")} packed run ${run.id} into ${out}`);
    } catch (err) {
      commandFailed(err);
    }
  });

runsCommand
  .command("import")
  .argument("<archive>", '.tgz ("runs pack") or .zip (a GitHub run artifact)')
  .argument("[path]", "directory containing a .testfile folder", ".")
  .description("Import a packed run into the local history")
  .action((archive: string, path: string) => {
    try {
      reportImport(importRunArchive(resolveHistoryBase(path), resolve(archive)));
    } catch (err) {
      commandFailed(err);
    }
  });

runsCommand
  .command("push")
  .argument("<s3-prefix>", "s3://bucket/prefix to upload to (uses the aws CLI)")
  .argument("[path]", "directory containing a .testfile folder", ".")
  .option("--run <id>", "run to push, id prefix is enough (default: the latest run)")
  .description("Pack a recorded run and upload it to S3")
  .action((prefix: string, path: string, options: { run?: string }) => {
    try {
      const base = resolveHistoryBase(path);
      const run = pickRun(base, options.run);
      const url = s3Push(base, run.id, prefix);
      console.log(`${color(32, "✔")} pushed run ${run.id} to ${url}`);
    } catch (err) {
      commandFailed(err);
    }
  });

runsCommand
  .command("pull")
  .argument("<s3-prefix>", "s3://bucket/prefix to download from (uses the aws CLI)")
  .argument("[path]", "directory containing a .testfile folder", ".")
  .option("--run <id>", "exact run id to pull (default: the newest archive)")
  .description("Download a run archive from S3 into the local history")
  .action((prefix: string, path: string, options: { run?: string }) => {
    try {
      reportImport(s3Pull(resolveHistoryBase(path), prefix, options.run));
    } catch (err) {
      commandFailed(err);
    }
  });

runsCommand
  .command("sync")
  .argument("<owner/repo>", "GitHub repository whose workflow runs to sync from")
  .argument("[path]", "directory containing a .testfile folder", ".")
  .option(
    "--latest <n>",
    "number of recent workflow runs to consider",
    (value: string) => Number.parseInt(value, 10),
    5
  )
  .option("--artifact <name>", "artifact name the action uploads", "testfile-run")
  .description("Download the run artifacts of recent GitHub Actions runs (needs GITHUB_TOKEN)")
  .action(async (repo: string, path: string, options: { latest: number; artifact: string }) => {
    try {
      if (!(options.latest >= 1)) throw new Error("--latest must be a positive integer");
      const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
      if (!token) {
        throw new Error("set GITHUB_TOKEN (or GH_TOKEN) to download workflow artifacts");
      }
      const result = await syncFromGithub(resolveHistoryBase(path), {
        repo,
        latest: options.latest,
        artifact: options.artifact,
        token,
      });
      if (result.archives === 0) {
        console.log(
          color(90, `no "${options.artifact}" artifacts in the last ${options.latest} workflow runs`)
        );
      }
      reportImport(result);
    } catch (err) {
      commandFailed(err);
    }
  });

await program.parseAsync(process.argv);
