// The runner as a library: reading a Testfile, expanding it into a suite,
// and running it - processes, containers and clusters included.
//
// This is the only package here that starts anything. Nothing exported from
// this entry point parses an argument or owns a terminal, so the VS Code
// extension, a CI wrapper or a test of our own can run a suite without
// going through a shell. The command line over it - `testfile-runner`, and
// the same commands inside @testfile.dev/cli's single `testfile` binary -
// is `./cli`, kept out of here so importing the library pulls no commander.
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
