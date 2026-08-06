import type { Command } from "commander";
import { variantLabel } from "../merge.js";
import { color, formatMs, pad } from "../util.js";
import type { RunRecordSuiteNode } from "../runrecord.js";
import { timelineRows } from "../tui/model.js";
import { colorStatus, commandFailed, findRun, loadedHistory } from "./shared.js";

export function registerRun(program: Command): void {
  program
    .command("run")
    .argument("<id>", "recorded run to show (a unique id prefix is enough)")
    .argument("[path]", "directory containing a .testfile folder", ".")
    .option("--log [test-path]", "print the run's merged log, or a single test's log")
    .description("Show one recorded run")
    .action((id: string, path: string, options: { log?: string | boolean }) => {
      try {
        const history = loadedHistory(path);
        const run = findRun(history, id);

        if (options.log !== undefined) {
          const text =
            typeof options.log === "string"
              ? (() => {
                  const test = run.tests.find((t) => t.path === options.log);
                  return test ? history.readLog(run, test) : undefined;
                })()
              : history.readRunLog(run);
          if (text === undefined) {
            throw new Error(
              `no log found${typeof options.log === "string" ? ` for test "${options.log}"` : ""} in run ${run.id}`,
            );
          }
          process.stdout.write(text);
          return;
        }

        console.log(`${color(1, `run ${run.id}`)}`);
        console.log(`started:   ${run.startedAt}`);
        console.log(`duration:  ${formatMs(run.durationMs)}`);
        console.log(`status:    ${colorStatus(run.status)} (exit code ${run.exitCode})`);
        console.log(`cancelled: ${run.cancelled ? "yes" : "no"}`);
        if (run.machine) console.log(`machine:   ${run.machine}`);
        const variants = variantLabel(run.variants);
        if (variants) console.log(`variants:  ${variants}`);
        const labels = variantLabel(run.labels);
        if (labels) console.log(`labels:    ${labels}`);
        if (run.merged) {
          const all = Object.entries(run.merged.variants ?? {})
            .map(([key, values]) => `${key}=${values.join("|")}`)
            .join(", ");
          console.log(`merged:    ${run.merged.runs.length} runs${all ? ` (${all})` : ""}`);
          for (const source of run.merged.runs) {
            const where = variantLabel(source.variants);
            console.log(
              `  ${pad(colorStatus(source.status), 7)} ${source.id}` +
                (where ? color(90, `  [${where}]`) : "") +
                (source.machine ? color(90, `  ${source.machine}`) : ""),
            );
          }
        }
        console.log(`selected:  ${run.selected.join(", ") || "-"}`);
        const env = Object.entries(run.env)
          .map(([k, v]) => `${k}=${v}`)
          .join(" ");
        if (env) console.log(`env:       ${env}`);
        const ports = Object.entries(run.ports)
          .map(([k, v]) => `${k}=${v}`)
          .join(" ");
        if (ports) console.log(`ports:     ${ports}`);
        // Tags come from the recorded suite tree, including the ones a test
        // inherits from its groups (older records simply have no tree).
        const tagsByPath = new Map<string, string[]>();
        const collectTags = (node: RunRecordSuiteNode, inherited: readonly string[]): void => {
          const own = [...new Set([...inherited, ...(node.tags ?? [])])];
          if (own.length > 0) tagsByPath.set(node.path, own);
          for (const child of node.children ?? []) collectTags(child, own);
        };
        if (run.suite) collectTags(run.suite, []);

        console.log("tests:");
        for (const test of run.tests) {
          const started =
            test.startedAfterMs !== undefined
              ? color(90, ` +${formatMs(test.startedAfterMs)}`)
              : "";
          const duration = test.durationMs !== undefined ? ` (${formatMs(test.durationMs)})` : "";
          const log = test.log ? color(90, "  [log]") : "";
          const artifacts = test.artifacts?.length
            ? color(
                90,
                `  [${test.artifacts.length} artifact${test.artifacts.length === 1 ? "" : "s"}]`,
              )
            : "";
          const cached = test.cached ? color(90, "  [cached]") : "";
          const where = variantLabel(test.variants);
          const variant = where ? color(36, `  [${where}]`) : "";
          const tags = tagsByPath.has(test.path)
            ? color(90, `  [${tagsByPath.get(test.path)!.join(", ")}]`)
            : "";
          console.log(
            `  ${pad(colorStatus(test.status), 7)} ${test.path}${variant}${started}${duration}${tags}${log}${artifacts}${cached}`,
          );
          if (test.reason) console.log(color(90, `          ${test.reason}`));
        }
        // when each test ran, on one axis - the shape of the run
        const timeline = timelineRows(run);
        if (timeline.length > 0) {
          const width = Math.max(...timeline.map((row) => row.path.length));
          console.log("timeline:");
          for (const row of timeline) {
            console.log(`  ${pad(row.path, width)} |${row.bar}| ${color(90, row.label)}`);
          }
        }
        if (run.services?.length) {
          console.log("services:");
          for (const service of run.services) {
            const log = service.log ? color(90, "  [log]") : "";
            console.log(`  ${pad(service.status ?? "-", 7)} ${service.name}${log}`);
          }
        }
        console.log(color(90, `\nlogs: testfile-viewer run ${run.id} --log [test-path]`));
      } catch (err) {
        commandFailed(err);
      }
    });
}
