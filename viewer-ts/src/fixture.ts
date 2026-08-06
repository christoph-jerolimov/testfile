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
  // When the test started; the offset into the run is derived from it, as a
  // runner would record the pair.
  startedAt?: string;
}

export function writeRun(
  baseDir: string,
  id: string,
  startedAt: string,
  tests: FixtureTest[],
  options: {
    status?: RunRecord["status"];
    services?: { name: string; status?: string; log?: string }[];
    variants?: Record<string, string>;
  } = {},
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
    ...(options.variants ? { variants: options.variants } : {}),
    env: {},
    ports: {},
    selected: [],
    tests: [],
  };
  tests.forEach((test, index) => {
    const entry: RunRecord["tests"][number] = { path: test.path, status: test.status };
    if (test.startedAt !== undefined) {
      entry.startedAt = test.startedAt;
      entry.startedAfterMs = Math.max(0, Date.parse(test.startedAt) - Date.parse(startedAt));
    }
    if (test.durationMs !== undefined) entry.durationMs = test.durationMs;
    if (test.log !== undefined) {
      entry.log = `tests/${index}.log`;
      writeFileSync(join(runDir, entry.log), test.log);
    }
    record.tests.push(entry);
  });
  (options.services ?? []).forEach((service, index) => {
    const entry: NonNullable<RunRecord["services"]>[number] = { name: service.name };
    if (service.status) entry.status = service.status;
    if (service.log !== undefined) {
      entry.log = `services/${index}.log`;
      mkdirSync(join(runDir, "services"), { recursive: true });
      writeFileSync(join(runDir, entry.log), service.log);
    }
    (record.services ??= []).push(entry);
  });
  writeFileSync(join(runDir, "run.yaml"), stringify(record));
  return record;
}
