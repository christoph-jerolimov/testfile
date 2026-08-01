#!/usr/bin/env node
// Packs the most recent recorded run as a .tgz (same layout that
// `testfile runs pack` produces), so the action can upload it as a build
// artifact and `testfile runs sync` can import it later. Exits quietly
// when there is no run record.
//
//   node pack-run.mjs <tested-path> <output.tgz>
import { spawnSync } from "node:child_process";
import { latestRun } from "./record.mjs";

const outFile = process.argv[3];
if (!outFile) {
  console.error("usage: pack-run.mjs <tested-path> <output.tgz>");
  process.exit(1);
}
const located = latestRun(process.argv[2]);
if (!located) process.exit(0);

const result = spawnSync("tar", ["-czf", outFile, "-C", located.runsDir, located.run.id], {
  stdio: "inherit",
});
if (result.status !== 0) process.exit(result.status ?? 1);
console.log(`packed run ${located.run.id} into ${outFile}`);
