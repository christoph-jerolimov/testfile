import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parse, stringify } from "yaml";
import { junitFromRecord } from "./junit.js";
import type { OutputLine } from "./output.js";
import type { Status } from "./runtree.js";

// Runs are persisted next to the Testfile in this folder: one self-contained
// runs/<id>/ folder per run, holding run.yaml (the run's record) and the
// merged stdout+stderr logs. The folder ignores itself via an own .gitignore.
export const HISTORY_DIR = ".testfile";

export interface RunRecordTest {
  path: string;
  status: Status;
  durationMs?: number;
  // Log file relative to the run's folder, when the test produced output.
  log?: string;
  // Collected artifact files, relative to the run's folder.
  artifacts?: string[];
  // True when the result was reused from the cache (inputs unchanged).
  cached?: boolean;
}

export interface RunRecordService {
  name: string;
  // Last observed status (ready, stopped, failed, ...), when known.
  status?: string;
  // Log file relative to the run's folder, when the service produced output.
  log?: string;
}

export interface RunRecord {
  id: string;
  startedAt: string;
  durationMs: number;
  status: "passed" | "failed" | "aborted";
  exitCode: number;
  cancelled: boolean;
  // Env provided by the Testfile (top level, resolved) and the resolved ports.
  env: Record<string, string>;
  ports: Record<string, number>;
  // Paths of the tests the user selected for this run.
  selected: string[];
  tests: RunRecordTest[];
  // Services that were started during the run.
  services?: RunRecordService[];
  // JUnit XML of this run, relative to the run's folder.
  junit?: string;
}

export interface RunMeta {
  // Display name of the project (the Testfile's `name`), for reports.
  name?: string;
  startedAtMs: number;
  durationMs: number;
  status: "passed" | "failed" | "aborted";
  exitCode: number;
  cancelled: boolean;
  env: Record<string, string>;
  ports: Record<string, number>;
  selected: string[];
}

export interface RunLogInput {
  path: string;
  status: Status;
  durationMs?: number;
  lines: OutputLine[];
  // Files to copy into the run's artifacts folder.
  artifacts?: { absolute: string; relative: string }[];
  cached?: boolean;
}

export class RunHistory {
  readonly dir: string;
  private index: RunRecord[] = [];

  constructor(baseDir: string, private readonly keep = 50) {
    this.dir = join(baseDir, HISTORY_DIR);
    this.migrateLegacyIndex();
    this.index = this.load();
  }

  // Earlier versions kept one runs.yaml index for all runs; each entry now
  // becomes a run.yaml inside its run folder (created if it was pruned).
  private migrateLegacyIndex(): void {
    const legacy = join(this.dir, "runs.yaml");
    if (!existsSync(legacy)) return;
    try {
      const parsed = parse(readFileSync(legacy, "utf8")) as { runs?: RunRecord[] } | null;
      for (const run of parsed?.runs ?? []) {
        if (!run?.id) continue;
        const file = join(this.dir, "runs", run.id, "run.yaml");
        if (existsSync(file)) continue;
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, stringify(run));
      }
      rmSync(legacy);
    } catch {
      // an unreadable legacy index is not worth failing for
    }
  }

  // Scans runs/<id>/run.yaml; unreadable entries are skipped. Newest first.
  private load(): RunRecord[] {
    const runs: RunRecord[] = [];
    let entries: string[];
    try {
      entries = readdirSync(join(this.dir, "runs"), { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name);
    } catch {
      return runs; // no history yet
    }
    for (const id of entries) {
      try {
        const record = parse(readFileSync(join(this.dir, "runs", id, "run.yaml"), "utf8")) as
          | RunRecord
          | null;
        if (record && typeof record === "object" && Array.isArray(record.tests)) {
          runs.push({ ...record, id: record.id ?? id });
        }
      } catch {
        // a run folder without a (readable) run.yaml is not a run
      }
    }
    // startedAt has millisecond resolution; the id (which starts with the
    // run's UTC timestamp) only resolves seconds, so it is the tie-breaker.
    return runs.sort(
      (a, b) => b.startedAt.localeCompare(a.startedAt) || b.id.localeCompare(a.id)
    );
  }

  // Newest first.
  get runs(): readonly RunRecord[] {
    return this.index;
  }

  // Re-reads the run folders, picking up runs recorded by other processes.
  reload(): void {
    this.index = this.load();
  }

  // Looks a run up by its id; a unique prefix is sufficient.
  find(idOrPrefix: string): RunRecord | undefined {
    const exact = this.index.find((run) => run.id === idOrPrefix);
    if (exact) return exact;
    const matches = this.index.filter((run) => run.id.startsWith(idOrPrefix));
    return matches.length === 1 ? matches[0] : undefined;
  }

  latestFor(path: string): { run: RunRecord; test: RunRecordTest } | undefined {
    for (const run of this.index) {
      const test = run.tests.find((t) => t.path === path);
      if (test) return { run, test };
    }
    return undefined;
  }

  readLog(run: RunRecord, test: RunRecordTest): string | undefined {
    if (!test.log) return undefined;
    try {
      return readFileSync(join(this.dir, "runs", run.id, test.log), "utf8");
    } catch {
      return undefined;
    }
  }

  // The merged stdout+stderr of the whole run, assembled on demand from the
  // per-test logs. (Older runs recorded a pre-merged output.log; when one
  // exists it is served as-is.)
  readRunLog(run: RunRecord): string | undefined {
    try {
      return readFileSync(join(this.dir, "runs", run.id, "output.log"), "utf8");
    } catch {
      // no legacy file: assemble from the per-test logs below
    }
    const parts: string[] = [];
    for (const test of run.tests) {
      const duration = test.durationMs !== undefined ? `, ${test.durationMs}ms` : "";
      parts.push(`=== ${test.path} (${test.status}${duration}) ===`);
      const log = this.readLog(run, test);
      if (log !== undefined && log !== "") parts.push(log.trimEnd());
    }
    for (const service of run.services ?? []) {
      parts.push(`=== service ${service.name}${service.status ? ` (${service.status})` : ""} ===`);
      const log = this.readServiceLog(run, service);
      if (log !== undefined && log !== "") parts.push(log.trimEnd());
    }
    return parts.length === 0 ? undefined : `${parts.join("\n")}\n`;
  }

  readServiceLog(run: RunRecord, service: RunRecordService): string | undefined {
    if (!service.log) return undefined;
    try {
      return readFileSync(join(this.dir, "runs", run.id, service.log), "utf8");
    } catch {
      return undefined;
    }
  }

  saveRun(
    meta: RunMeta,
    tests: RunLogInput[],
    services: { name: string; status?: string; lines: OutputLine[] }[]
  ): RunRecord {
    const startedAt = new Date(meta.startedAtMs);
    const stamp = startedAt.toISOString().slice(0, 19).replace(/[-:]/g, "").replace("T", "-");
    const id = `${stamp}-${Math.random().toString(16).slice(2, 6)}`;
    const runDir = join(this.dir, "runs", id);
    mkdirSync(join(runDir, "tests"), { recursive: true });
    writeFileSync(join(this.dir, ".gitignore"), "*\n");

    const record: RunRecord = {
      id,
      startedAt: startedAt.toISOString(),
      durationMs: meta.durationMs,
      status: meta.status,
      exitCode: meta.exitCode,
      cancelled: meta.cancelled,
      env: meta.env,
      ports: meta.ports,
      selected: meta.selected,
      tests: [],
    };

    for (const test of tests) {
      const entry: RunRecordTest = { path: test.path, status: test.status };
      if (test.durationMs !== undefined) entry.durationMs = test.durationMs;
      if (test.cached) entry.cached = true;
      if (test.lines.length > 0) {
        entry.log = join("tests", `${slugify(test.path)}.log`);
        writeFileSync(join(runDir, entry.log), renderLines(test.lines));
      }
      if (test.artifacts && test.artifacts.length > 0) {
        entry.artifacts = [];
        const slug = slugify(test.path);
        for (const artifact of test.artifacts) {
          const target = join("artifacts", slug, artifact.relative);
          try {
            mkdirSync(join(runDir, dirname(target)), { recursive: true });
            cpSync(artifact.absolute, join(runDir, target));
            entry.artifacts.push(target);
          } catch {
            // a vanished file is not worth failing the record for
          }
        }
      }
      record.tests.push(entry);
    }
    for (const service of services) {
      const entry: RunRecordService = { name: service.name };
      if (service.status !== undefined) entry.status = service.status;
      if (service.lines.length > 0) {
        entry.log = join("services", `${slugify(service.name)}.log`);
        mkdirSync(join(runDir, "services"), { recursive: true });
        writeFileSync(join(runDir, entry.log), renderLines(service.lines));
      }
      (record.services ??= []).push(entry);
    }
    // JUnit result next to the record, so CI tooling can pick it up from
    // the run folder (and the uploaded artifact) directly.
    const logByPath = new Map(tests.map((test) => [test.path, test.lines]));
    writeFileSync(
      join(runDir, "junit.xml"),
      junitFromRecord(record, {
        name: meta.name,
        readLog: (test) => {
          const testLines = logByPath.get(test.path);
          return testLines && testLines.length > 0 ? renderLines(testLines) : undefined;
        },
      })
    );
    record.junit = "junit.xml";
    writeFileSync(join(runDir, "run.yaml"), stringify(record));

    this.index.unshift(record);
    for (const pruned of this.index.splice(this.keep)) {
      rmSync(join(this.dir, "runs", pruned.id), { recursive: true, force: true });
    }
    return record;
  }
}

// Merged stdout+stderr; runner messages are marked as comments.
function renderLines(lines: OutputLine[]): string {
  return `${lines.map((l) => (l.stream === "system" ? `# ${l.text}` : l.text)).join("\n")}\n`;
}

function slugify(path: string): string {
  const slug = path
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  // Short hash so distinct paths with the same slug don't collide.
  let hash = 0;
  for (let i = 0; i < path.length; i++) hash = (hash * 31 + path.charCodeAt(i)) >>> 0;
  return `${slug || "test"}-${hash.toString(16)}`;
}
