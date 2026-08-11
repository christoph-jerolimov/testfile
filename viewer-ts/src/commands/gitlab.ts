import type { Command } from "commander";
import { gitlabRunArchives, lineProgress, syncFromGitlab } from "@testfile/sync";
import { color, pad } from "@testfile/core";
import { commandFailed, reportImport, resolveHistoryBase, wantsJson, writeJson } from "./shared.js";

export function registerGitlab(program: Command): void {
  const gitlabCommand = program
    .command("gitlab")
    .description(
      "Bring run artifacts of GitLab CI jobs into the local history (needs GITLAB_TOKEN)",
    );

  function gitlabToken(): string {
    const token = process.env.GITLAB_TOKEN ?? process.env.CI_JOB_TOKEN;
    if (!token) throw new Error("set GITLAB_TOKEN to access job artifacts");
    return token;
  }

  const addOptions = (command: ReturnType<Command["command"]>): ReturnType<Command["command"]> =>
    command
      .option(
        "--latest <n>",
        "number of recent pipelines to consider",
        (value: string) => Number.parseInt(value, 10),
        5,
      )
      .option("--job <name>", "job whose artifacts hold the run", "testfile")
      .option("--ref <ref>", "only pipelines for this branch or tag")
      .option("--host <url>", "self-hosted GitLab instance", "https://gitlab.com");

  addOptions(
    gitlabCommand
      .command("sync")
      .argument("<project>", 'project path ("group/project") or numeric id')
      .argument("[path]", "directory containing a .testfile folder", ".")
      .description("Download the run artifacts of recent pipelines and import them"),
  ).action(
    async (
      project: string,
      path: string,
      options: { latest: number; job: string; ref?: string; host: string },
    ) => {
      try {
        if (!(options.latest >= 1)) throw new Error("--latest must be a positive integer");
        const result = await syncFromGitlab(resolveHistoryBase(path), {
          project,
          latest: options.latest,
          job: options.job,
          ref: options.ref,
          host: options.host,
          token: gitlabToken(),
          progress: lineProgress(),
        });
        if (result.archives === 0) {
          console.log(
            color(90, `no "${options.job}" job artifacts in the last ${options.latest} pipelines`),
          );
        }
        reportImport(result);
      } catch (err) {
        commandFailed(err);
      }
    },
  );

  addOptions(
    gitlabCommand
      .command("list")
      .argument("<project>", 'project path ("group/project") or numeric id')
      .option("--json [file]", "write the artifacts as JSON, to a file or (without a value) stdout")
      .description("List the run artifacts available in recent pipelines"),
  ).action(
    async (
      project: string,
      options: {
        latest: number;
        job: string;
        ref?: string;
        host: string;
        json?: string | boolean;
      },
    ) => {
      try {
        if (!(options.latest >= 1)) throw new Error("--latest must be a positive integer");
        const archives = await gitlabRunArchives({
          project,
          latest: options.latest,
          job: options.job,
          ref: options.ref,
          host: options.host,
          token: gitlabToken(),
        });
        if (wantsJson(options.json)) {
          writeJson({ project, artifacts: archives }, options.json);
          return;
        }
        if (archives.length === 0) {
          console.log(
            color(90, `no "${options.job}" job artifacts in the last ${options.latest} pipelines`),
          );
          return;
        }
        const rows = archives.map((archive) => [
          String(archive.pipeline),
          String(archive.job),
          archive.jobName,
          archive.createdAt ? archive.createdAt.replace("T", " ").slice(0, 19) : "-",
        ]);
        const header = ["PIPELINE", "JOB", "NAME", "CREATED"];
        const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
        console.log(color(1, header.map((h, i) => pad(h, widths[i])).join("  ")));
        for (const row of rows) console.log(row.map((cell, i) => pad(cell, widths[i])).join("  "));
        console.log(color(90, `\nimport them with: testfile-viewer gitlab sync ${project}`));
      } catch (err) {
        commandFailed(err);
      }
    },
  );
}
