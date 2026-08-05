import type { Command } from "commander";
import { variantLabel } from "../merge.js";
import { detectFlaky } from "../runrecord.js";
import { color, formatMs, pad } from "../util.js";
import { colorStatus, commandFailed, loadedHistory, summarizeTests, writeJson } from "./shared.js";

export function registerRuns(program: Command): void {
  program
    .command("runs", { isDefault: true })
    .argument("[path]", "directory containing a .testfile folder", ".")
    .option("--json [file]", "write the runs as JSON, to a file or (without a value) stdout")
    .option("--flaky", "find tests that both passed and failed across recorded runs", false)
    .option("--last <n>", "with --flaky: only consider the most recent n runs", (v: string) =>
      Number.parseInt(v, 10),
    )
    .description("List recorded runs (the default command)")
    .action((path: string, options: { json?: string | boolean; flaky: boolean; last?: number }) => {
      try {
        const history = loadedHistory(path);

        if (options.flaky) {
          const considered =
            options.last !== undefined
              ? Math.min(options.last, history.runs.length)
              : history.runs.length;
          const reports = detectFlaky(history.runs, options.last);
          if (options.json !== undefined && options.json !== false) {
            writeJson({ considered, flaky: reports }, options.json);
            return;
          }
          if (reports.length === 0) {
            console.log(
              `no flaky tests detected across ${considered} run${considered === 1 ? "" : "s"}`,
            );
            return;
          }
          console.log(
            color(1, `flaky tests across ${considered} run${considered === 1 ? "" : "s"}:`),
          );
          for (const report of reports) {
            const rate = `${report.fails}/${report.occurrences} failed`;
            const flips = `${report.flips} flip${report.flips === 1 ? "" : "s"}`;
            const last = `last ${colorStatus(report.lastStatus)}`;
            console.log(`  ${pad(color(33, report.path), 40)} ${rate}, ${flips}, ${last}`);
          }
          console.log(color(90, '\nconsider tagging these tests [flaky] and adding "retry"'));
          return;
        }

        if (options.json !== undefined && options.json !== false) {
          writeJson({ runs: history.runs }, options.json);
          return;
        }

        // The variants column only appears when some run has variants, so a
        // history without a matrix keeps the narrow table.
        const label = (run: (typeof history.runs)[number]): string =>
          run.merged
            ? Object.entries(run.merged.variants ?? {})
                .map(([key, values]) => `${key}=${values.join("|")}`)
                .join(", ") || `merged (${run.merged.runs.length})`
            : variantLabel(run.variants);
        const anyVariants = history.runs.some((run) => label(run) !== "");
        const rows = history.runs.map((run) => [
          run.id,
          run.startedAt.replace("T", " ").slice(0, 19),
          run.status,
          formatMs(run.durationMs),
          String(run.exitCode),
          ...(anyVariants ? [label(run) || "-"] : []),
          summarizeTests(run),
        ]);
        const header = [
          "ID",
          "STARTED",
          "STATUS",
          "DURATION",
          "EXIT",
          ...(anyVariants ? ["VARIANTS"] : []),
          "TESTS",
        ];
        const widths = header.map((h, i) =>
          Math.max(h.length, ...rows.map((r) => pad(r[i], 0).length)),
        );
        console.log(color(1, header.map((h, i) => pad(h, widths[i])).join("  ")));
        for (const row of rows) {
          row[2] = colorStatus(row[2]);
          console.log(row.map((cell, i) => pad(cell, widths[i])).join("  "));
        }
        console.log(color(90, `\ndetails: testfile-viewer run <id>`));
      } catch (err) {
        commandFailed(err);
      }
    });
}
