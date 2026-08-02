// Test helper: fabricates run folders in the on-disk result format (the
// viewer itself never writes runs - a runner does).
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { stringify } from "yaml";
import type { RunRecord } from "./runrecord.js";

export interface FixtureTest {
  path: string;
  status: RunRecord["tests"][number]["status"];
  durationMs?: number;
  log?: string; // log content; stored under tests/<n>.log
}

export function writeRun(
  baseDir: string,
  id: string,
  startedAt: string,
  tests: FixtureTest[],
  options: { status?: RunRecord["status"]; services?: { name: string; status?: string; log?: string }[] } = {}
): RunRecord {
  const runDir = join(baseDir, ".testfile", "runs", id);
  mkdirSync(join(runDir, "tests"), { recursive: true });
  const record: RunRecord = {
    id,
    startedAt,
    durationMs: 5,
    status: options.status ?? "passed",
    exitCode: options.status === "failed" ? 1 : 0,
    cancelled: false,
    env: {},
    ports: {},
    selected: [],
    tests: [],
  };
  tests.forEach((test, index) => {
    const entry: RunRecord["tests"][number] = { path: test.path, status: test.status };
    if (test.durationMs !== undefined) entry.durationMs = test.durationMs;
    if (test.log !== undefined) {
      entry.log = join("tests", `${index}.log`);
      writeFileSync(join(runDir, entry.log), test.log);
    }
    record.tests.push(entry);
  });
  (options.services ?? []).forEach((service, index) => {
    const entry: NonNullable<RunRecord["services"]>[number] = { name: service.name };
    if (service.status) entry.status = service.status;
    if (service.log !== undefined) {
      entry.log = join("services", `${index}.log`);
      mkdirSync(join(runDir, "services"), { recursive: true });
      writeFileSync(join(runDir, entry.log), service.log);
    }
    (record.services ??= []).push(entry);
  });
  writeFileSync(join(runDir, "run.yaml"), stringify(record));
  return record;
}
