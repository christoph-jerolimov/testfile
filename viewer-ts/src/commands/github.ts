import type { Command } from "commander";
import { githubRunArchives, lineProgress, syncFromGithub } from "../transfer/index.js";
import { color, pad } from "../util.js";
import { commandFailed, reportImport, resolveHistoryBase, wantsJson, writeJson } from "./shared.js";

interface GithubCliOptions {
  latest: number;
  artifact: string;
  exact: boolean;
}

function nothingFound(options: GithubCliOptions): string {
  const what = options.exact
    ? `no "${options.artifact}" artifacts`
    : `no artifacts starting with "${options.artifact}"`;
  return `${what} in the last ${options.latest} workflow runs`;
}

export function registerGithub(program: Command): void {
  const githubCommand = program
    .command("github")
    .description(
      "Bring run artifacts of GitHub Actions runs into the local history (needs GITHUB_TOKEN)",
    );

  function githubToken(): string {
    const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
    if (!token) throw new Error("set GITHUB_TOKEN (or GH_TOKEN) to access workflow artifacts");
    return token;
  }

  function addGithubOptions(
    command: ReturnType<Command["command"]>,
  ): ReturnType<Command["command"]> {
    return command
      .option(
        "--latest <n>",
        "number of recent workflow runs to consider",
        (value: string) => Number.parseInt(value, 10),
        100,
      )
      .option(
        "--artifact <name>",
        "artifact name the action uploads; matched as a prefix, so one matrix leg per platform and the merged run all come along",
        "testfile-run",
      )
      .option("--exact", "require the artifact name to match exactly", false);
  }

  addGithubOptions(
    githubCommand
      .command("sync")
      .argument("<owner/repo>", "GitHub repository whose workflow runs to sync from")
      .argument("[path]", "directory containing a .testfile folder", ".")
      .description("Download the run artifacts of recent workflow runs and import them"),
  ).action(async (repo: string, path: string, options: GithubCliOptions) => {
    try {
      if (!(options.latest >= 1)) throw new Error("--latest must be a positive integer");
      const result = await syncFromGithub(resolveHistoryBase(path), {
        repo,
        latest: options.latest,
        artifact: options.artifact,
        exact: options.exact,
        token: githubToken(),
        progress: lineProgress(),
      });
      if (result.archives === 0) console.log(color(90, nothingFound(options)));
      reportImport(result);
    } catch (err) {
      commandFailed(err);
    }
  });

  addGithubOptions(
    githubCommand
      .command("list")
      .argument("<owner/repo>", "GitHub repository whose workflow runs to list")
      .option("--json [file]", "write the artifacts as JSON, to a file or (without a value) stdout")
      .description("List the run artifacts available in recent workflow runs"),
  ).action(async (repo: string, options: GithubCliOptions & { json?: string | boolean }) => {
    try {
      if (!(options.latest >= 1)) throw new Error("--latest must be a positive integer");
      const archives = await githubRunArchives({
        repo,
        latest: options.latest,
        artifact: options.artifact,
        exact: options.exact,
        token: githubToken(),
      });
      if (wantsJson(options.json)) {
        writeJson({ repo, artifacts: archives }, options.json);
        return;
      }
      if (archives.length === 0) {
        console.log(color(90, nothingFound(options)));
        return;
      }
      const rows = archives.map((archive) => [
        String(archive.workflowRun),
        archive.name,
        archive.workflowName || "-",
        archive.createdAt ? archive.createdAt.replace("T", " ").slice(0, 19) : "-",
        archive.sizeBytes !== undefined
          ? `${Math.max(1, Math.round(archive.sizeBytes / 1024))} KiB`
          : "-",
      ]);
      const header = ["WORKFLOW RUN", "ARTIFACT", "WORKFLOW", "CREATED", "SIZE"];
      const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
      console.log(color(1, header.map((h, i) => pad(h, widths[i])).join("  ")));
      for (const row of rows) console.log(row.map((cell, i) => pad(cell, widths[i])).join("  "));
      console.log(color(90, `\nimport them with: testfile-viewer github sync ${repo}`));
    } catch (err) {
      commandFailed(err);
    }
  });
}
