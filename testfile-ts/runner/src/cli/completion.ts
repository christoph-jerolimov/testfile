import { type Command } from "commander";
import { color, type CompletionModel, generateCompletion } from "../index.js";

export function registerCompletion(program: Command): void {
  program
    .command("completion")
    .argument("<shell>", "bash, zsh or fish")
    .description("Print a shell completion script")
    .action((shell: string) => {
      try {
        const model: CompletionModel = {
          // whichever binary registered these commands: `testfile` when the
          // full CLI did, `testfile-runner` on its own
          program: program.name(),
          commands: program.commands
            .filter((command) => command.name() !== "completion")
            .map((command) => ({
              name: command.name(),
              description: command.description(),
              flags: command.options.flatMap((option) =>
                option.flags.split(/[,\s]+/).filter((part) => part.startsWith("-")),
              ),
            })),
        };
        process.stdout.write(generateCompletion(model, shell));
      } catch (err) {
        console.error(`${color(31, "✘")} ${err instanceof Error ? err.message : err}`);
        process.exitCode = 1;
      }
    });
}
