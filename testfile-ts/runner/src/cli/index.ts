// The runner's command line: every command that asks something of a
// Testfile - what it describes, whether this machine can run it, and
// running it.
//
// They live next to the code they drive rather than in @testfile.dev/cli,
// because the package that starts processes is the one worth installing on
// its own to start them: `npx @testfile.dev/runner start` in a CI job pulls
// this package and its four dependencies, not the reader's Ink, React and
// web viewer. `main.ts` turns them into the `testfile-runner` binary;
// @testfile.dev/cli registers the same commands into the single `testfile`
// program, beside the read-only commands over recorded runs.
import { type Command } from "commander";
import { registerChanges } from "./changes.js";
import { registerDoctor } from "./doctor.js";
import { registerInit } from "./init.js";
import { registerInspect } from "./inspect.js";
import { registerStart } from "./start.js";
import { registerTags } from "./tags.js";
import { registerValidate } from "./validate.js";

export { registerChanges } from "./changes.js";
export { registerCompletion } from "./completion.js";
export { registerDoctor } from "./doctor.js";
export { registerInit } from "./init.js";
export { registerInspect } from "./inspect.js";
export { parseLabels, parseVariants, registerStart } from "./start.js";
export { registerTags } from "./tags.js";
export { registerValidate } from "./validate.js";
export {
  addFilterOptions,
  applyChanged,
  applyShard,
  type FilterFlags,
  resolveFilters,
  type SuiteEntry,
  suiteJson,
} from "./shared.js";

// Registers all of them, in the order they should appear in `--help`:
// creating a file, asking it questions, then running it.
//
// Returns the `inspect` command, so a caller that also knows about recorded
// runs can hang `inspect run <id>` off it - inspecting the suite and
// inspecting one run of it are the same question asked of the two halves of
// the tool, and @testfile.dev/cli spells them as one command.
export function registerSuiteCommands(program: Command): Command {
  registerInit(program);
  registerValidate(program);
  const inspect = registerInspect(program);
  registerTags(program);
  registerChanges(program);
  registerDoctor(program);
  // `start` is the default command
  registerStart(program);
  return inspect;
}
