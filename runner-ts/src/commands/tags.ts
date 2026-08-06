import { dirname } from "node:path";
import type { Command } from "commander";
import { loadTestfile } from "../loader.js";
import { Session } from "../session.js";
import { collectTags, sortTags } from "../tags.js";
import { color } from "../util.js";
import { wantsJson, writeJson } from "./shared.js";

export function registerTags(program: Command): void {
  program
    .command("tags")
    .argument("[path]", "Testfile or directory containing one", ".")
    .option("--order <order>", "alpha (default), appearance (document order) or count", "alpha")
    .option("--json [file]", "write the tags as JSON, to a file or (without a value) stdout")
    .description("List all tags of the full test suite (including included Testfiles)")
    .action((path: string, options: { order: string; json?: string | boolean }) => {
      try {
        if (
          options.order !== "alpha" &&
          options.order !== "appearance" &&
          options.order !== "count"
        ) {
          throw new Error(
            `unknown --order "${options.order}", expected alpha, appearance or count`,
          );
        }
        const { path: file, doc } = loadTestfile(path);
        const session = new Session(doc, dirname(file));
        const summary = collectTags(session.suite);
        const tags = sortTags(summary.tags, options.order);

        if (wantsJson(options.json)) {
          writeJson(
            {
              order: options.order,
              tags: tags.map(({ name, count, appearance }) => ({ name, count, appearance })),
              untagged: summary.untagged,
              tests: summary.tests,
            },
            options.json,
            "tags",
          );
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
                `${summary.untagged} without any tag`,
            ),
          );
        } else {
          for (const tag of tags) console.log(tag.name);
        }
      } catch (err) {
        console.error(`${color(31, "✘")} ${err instanceof Error ? err.message : err}`);
        process.exitCode = 1;
      }
    });
}
