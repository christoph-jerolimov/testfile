import { spawnSync } from "node:child_process";

// Sharing runs shells out to tar and unzip, and the tests that exercise it
// build their fixtures with sh and zip. Those are a given on Linux and
// macOS but not on Windows, so the tests ask for what they need and are
// skipped - not failed - where it is missing, the way the conformance
// suite handles a missing container engine.
//
// Whether the viewer should carry its own archive handling instead is a
// separate question; today it does not.

const known = new Map<string, boolean>();

function available(tool: string): boolean {
  let found = known.get(tool);
  if (found === undefined) {
    // --version is enough: every tool here supports it and none of them
    // does anything when only asked for it.
    found = spawnSync(tool, ["--version"], { stdio: "ignore" }).status === 0;
    known.set(tool, found);
  }
  return found;
}

// Returns a node:test `skip` value: false when everything is there, the
// reason string when something is not.
export function needs(...tools: string[]): string | false {
  const missing = tools.filter((tool) => !available(tool));
  return missing.length === 0 ? false : `needs ${missing.join(", ")}`;
}
