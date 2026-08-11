// The recorded-run domain, in one place: what a run.yaml is, how a history
// is read, and everything that can be computed from it.
//
// Nothing here starts a process or renders anything - a viewer, a server,
// an MCP tool and the runner's own tooling all read the same records, so
// the reading lives once, here, and each of them only decides what to show.
export * from "./runrecord.js";
export * from "./query.js";
export * from "./explain.js";
export * from "./repro.js";
export * from "./merge.js";
export * from "./runfilter.js";
export * from "./util.js";
export * from "./watch-runs.js";
