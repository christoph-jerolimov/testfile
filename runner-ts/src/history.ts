import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parse, stringify } from "yaml";
import type { OutputLine } from "./output.js";
import type { Status } from "./runtree.js";

// Runs are persisted next to the Testfile in this folder. It contains
// runs.yaml (the index of recent runs) and runs/<id>/ with the merged
// stdout+stderr logs. The folder ignores itself via an own .gitignore.
export const HISTORY_DIR = ".testfile";

export interface RunRecordTest {
  path: string;
  status: Status;
  durationMs?: number;
  // Log file relative to the run's folder, when the test produced output.
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
}

export interface RunMeta {
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
}

export class RunHistory {
  readonly dir: string;
  private index: RunRecord[] = [];

  constructor(baseDir: string, private readonly keep = 50) {
    this.dir = join(baseDir, HISTORY_DIR);
    try {
      const parsed = parse(readFileSync(join(this.dir, "runs.yaml"), "utf8")) as {
        runs?: RunRecord[];
      } | null;
      if (parsed && Array.isArray(parsed.runs)) this.index = parsed.runs;
    } catch {
      // no history yet
    }
  }

  // Newest first.
  get runs(): readonly RunRecord[] {
    return this.index;
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

  // The merged stdout+stderr of the whole run.
  readRunLog(run: RunRecord): string | undefined {
    try {
      return readFileSync(join(this.dir, "runs", run.id, "output.log"), "utf8");
    } catch {
      return undefined;
    }
  }

  saveRun(meta: RunMeta, tests: RunLogInput[], services: { name: string; lines: OutputLine[] }[]): RunRecord {
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

    const merged: string[] = [];
    for (const test of tests) {
      const entry: RunRecordTest = { path: test.path, status: test.status };
      if (test.durationMs !== undefined) entry.durationMs = test.durationMs;
      if (test.lines.length > 0) {
        entry.log = join("tests", `${slugify(test.path)}.log`);
        writeFileSync(join(runDir, entry.log), renderLines(test.lines));
      }
      record.tests.push(entry);
      const duration = test.durationMs !== undefined ? `, ${test.durationMs}ms` : "";
      merged.push(`=== ${test.path} (${test.status}${duration}) ===`);
      if (test.lines.length > 0) merged.push(renderLines(test.lines).trimEnd());
    }
    for (const service of services) {
      merged.push(`=== service ${service.name} ===`);
      if (service.lines.length > 0) merged.push(renderLines(service.lines).trimEnd());
    }
    writeFileSync(join(runDir, "output.log"), `${merged.join("\n")}\n`);

    this.index.unshift(record);
    for (const pruned of this.index.splice(this.keep)) {
      rmSync(join(this.dir, "runs", pruned.id), { recursive: true, force: true });
    }
    writeFileSync(join(this.dir, "runs.yaml"), stringify({ runs: this.index }));
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
