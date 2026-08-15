import type { Command } from "commander";
import {
  color,
  describeFilter,
  detectFlaky,
  filterRuns,
  formatMs,
  isEmptyFilter,
  labelOptions,
  pad,
  parseStatuses,
  type RunFilter,
  variantLabel,
  variantOptions,
} from "@testfile/core";
import {
  collect,
  colorStatus,
  commandFailed,
  loadedHistory,
  summarizeTests,
  writeJson,
} from "./shared.js";

export function registerRuns(program: Command): void {
  program
    .command("runs")
    .argument("[path]", "directory containing a .testfile folder", ".")
    .option("--json [file]", "write the runs as JSON, to a file or (without a value) stdout")
    .option("--flaky", "find tests that fail too often in their recent results to trust", false)
    .option(
      "--last <n>",
      "with --flaky: narrow the history to the most recent n runs",
      (v: string) => Number.parseInt(v, 10),
    )
    .option(
      "--filter-status <status>",
      "only runs with this status: passed, failed or aborted (repeatable)",
      collect,
      [],
    )
    .option(
      "--filter-label <key=value>",
      "only runs carrying this label; a bare key asks whether it is set at all (repeatable)",
      collect,
      [],
    )
    .option(
      "--filter-variant <key=value>",
      "only runs with this variant, including the legs of a merged run (repeatable)",
      collect,
      [],
    )
    .description("List recorded runs")
    .action(
      (
        path: string,
        options: {
          json?: string | boolean;
          flaky: boolean;
          last?: number;
          filterStatus: string[];
          filterLabel: string[];
          filterVariant: string[];
        },
      ) => {
        try {
          const loaded = loadedHistory(path);
          // The filters narrow what every part of the command works on: the
          // table, the JSON and the flaky report all see the same runs.
          const filter: RunFilter = {
            statuses: parseStatuses(options.filterStatus),
            labels: options.filterLabel,
            variants: options.filterVariant,
          };
          const selected = filterRuns(loaded.runs, filter);
          const history = { runs: selected };
          if (selected.length === 0 && loaded.runs.length > 0) {
            console.log(`no run matches the filters (${loaded.runs.length} recorded)`);
            const labels = labelOptions(loaded.runs);
            const variants = variantOptions(loaded.runs);
            if (options.filterLabel.length > 0 && labels.length > 0) {
              console.log(color(90, `labels in this history:   ${labels.join(", ")}`));
            }
            if (options.filterVariant.length > 0 && variants.length > 0) {
              console.log(color(90, `variants in this history: ${variants.join(", ")}`));
            }
            return;
          }

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
                `no flaky or broken tests detected across ${considered} run${
                  considered === 1 ? "" : "s"
                }`,
              );
              return;
            }
            console.log(
              color(1, `unreliable tests across ${considered} run${considered === 1 ? "" : "s"}:`),
            );
            for (const report of reports) {
              // broken is the worse verdict, so it is the louder colour
              const verdict = color(report.verdict === "broken" ? 31 : 33, pad(report.verdict, 6));
              const rate = `${report.fails}/${report.occurrences} failed`;
              const flips = `${report.flips} flip${report.flips === 1 ? "" : "s"}`;
              const last = `last ${colorStatus(report.lastStatus)}`;
              console.log(
                `  ${verdict} ${pad(color(33, report.path), 40)} ${rate}, ${flips}, ${last}`,
              );
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
          const shown = isEmptyFilter(filter)
            ? ""
            : `${describeFilter(history.runs.length, loaded.runs.length)} · `;
          console.log(color(90, `\n${shown}details: testfile inspect run <id>`));
        } catch (err) {
          commandFailed(err);
        }
      },
    );
}
