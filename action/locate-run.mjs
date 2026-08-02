#!/usr/bin/env node
// Prints the most recent recorded run's folder (and id) in
// $GITHUB_OUTPUT syntax, so the action can upload the folder directly as
// an artifact - GitHub zips it, no extra packing needed. Prints nothing
// when there is no run record.
//
//   node locate-run.mjs <tested-path> >> "$GITHUB_OUTPUT"
import { join } from "node:path";
import { latestRun } from "./record.mjs";

const located = latestRun(process.argv[2]);
if (!located) process.exit(0);
console.log(`run-dir=${join(located.runsDir, located.run.id)}`);
console.log(`run-id=${located.run.id}`);
