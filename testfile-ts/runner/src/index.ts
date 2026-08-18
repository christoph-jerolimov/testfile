// The runner as a library: reading a Testfile, expanding it into a suite,
// and running it - processes, containers and clusters included.
//
// This is the only package here that starts anything, and this entry stays
// a library: the VS Code extension, a CI wrapper or a test of our own can
// run a suite without going through a shell. The commands that drive it
// from one live in commands/ (exported as "@testfile.dev/runner/commands"),
// behind the package's own thin bin (cli.ts) - so `npx @testfile.dev/runner
// start` needs only this package - and @testfile.dev/cli registers the same
// commands next to its read-only history half.
export * from "./cache-predict.js";
export * from "./completion.js";
export * from "./configenv.js";
export * from "./doctor.js";
export * from "./filter.js";
export * from "./gitchanges.js";
export * from "./history.js";
export * from "./init.js";
export * from "./loader.js";
export * from "./model.js";
export * from "./report.js";
export * from "./reporter.js";
export * from "./runsuite.js";
export * from "./services.js";
export * from "./session.js";
export * from "./shard.js";
export * from "./streamreporter.js";
export * from "./tags.js";
export * from "./util.js";
export * from "./watch.js";
