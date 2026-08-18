// The runner's half of the command line: everything that reads the
// Testfile or runs it. Each register function hangs its command off
// whatever commander program it is given - the runner's own `cli.ts`
// registers just these, @testfile.dev/cli registers them next to the
// read-only history commands, and both get the same behavior.
export { registerChanges } from "./changes.js";
export { registerCompletion } from "./completion.js";
export { registerDoctor } from "./doctor.js";
export { registerInit } from "./init.js";
export { registerInspect } from "./inspect.js";
export { registerStart } from "./start.js";
export { registerTags } from "./tags.js";
export { registerValidate } from "./validate.js";
