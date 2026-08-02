// Pure helpers of the extension - no vscode imports, so they are unit
// tested with plain node:test.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { isMap, isScalar, isSeq, LineCounter, parseDocument, parse } from "yaml";
import type { Node, YAMLMap } from "yaml";

export const TESTFILE_NAMES = ["Testfile", "testfile.yaml", "testfile.yml"];

// One test in the document, with the 0-based line its node starts on.
export interface TestEntry {
  path: string;
  name: string;
  line: number;
  isGroup: boolean;
}

function scalarString(map: YAMLMap, key: string): string | undefined {
  const value = map.get(key, true);
  return isScalar(value) && typeof value.value === "string" ? value.value : undefined;
}

// Mirrors the runner's defaultName: name > truncated command > kind.
function nameOf(map: YAMLMap): string {
  const name = scalarString(map, "name");
  if (name) return name;
  const command = scalarString(map, "command");
  if (command) return command.length > 40 ? `${command.slice(0, 37)}...` : command;
  if (map.has("script")) return "script";
  if (map.has("sequence")) return "sequence";
  if (map.has("parallel")) return "parallel";
  return "test";
}

// Walks the tests of a Testfile document and lists every test with its
// path (names joined with "/", like the runner reports them).
export function listTests(text: string): TestEntry[] {
  const lineCounter = new LineCounter();
  const doc = parseDocument(text, { lineCounter, keepSourceTokens: true });
  const root = doc.contents;
  if (!isMap(root)) return [];
  const test = root.get("test", true);
  if (!isMap(test)) return [];

  const entries: TestEntry[] = [];
  const visit = (node: YAMLMap, parentPath: string): void => {
    const name = nameOf(node);
    const path = parentPath ? `${parentPath}/${name}` : name;
    const offset = (node as Node).range?.[0] ?? 0;
    const sequence = node.get("sequence", true);
    const parallel = node.get("parallel", true);
    const children = isSeq(sequence) ? sequence : isSeq(parallel) ? parallel : undefined;
    entries.push({
      path,
      name,
      line: lineCounter.linePos(offset).line - 1,
      isGroup: !!children,
    });
    if (children) {
      for (const child of children.items) {
        if (isMap(child)) visit(child, path);
      }
    }
  };
  visit(test, "");
  return entries;
}

// The test whose YAML node starts closest above the given line - what "run the
// test at the cursor" should run.
export function testAtLine(entries: TestEntry[], line: number): TestEntry | undefined {
  let best: TestEntry | undefined;
  for (const entry of entries) {
    if (entry.line <= line && (!best || entry.line >= best.line)) best = entry;
  }
  return best;
}

// A recorded run, as far as the Testfile Runs view needs it.
export interface RunInfo {
  id: string;
  startedAt: string;
  status: string;
  durationMs: number;
  tests: { path: string; status: string; durationMs?: number; log?: string }[];
  dir: string;
}

// Reads .testfile/runs/*/run.yaml under a workspace folder, newest first.
export function listRuns(baseDir: string, limit = 20): RunInfo[] {
  const runsDir = join(baseDir, ".testfile", "runs");
  if (!existsSync(runsDir)) return [];
  const runs: RunInfo[] = [];
  for (const id of readdirSync(runsDir)) {
    const dir = join(runsDir, id);
    try {
      const record = parse(readFileSync(join(dir, "run.yaml"), "utf8")) as RunInfo | null;
      if (record && Array.isArray(record.tests)) runs.push({ ...record, id: record.id ?? id, dir });
    } catch {
      // not a run folder
    }
  }
  return runs
    .sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)) || b.id.localeCompare(a.id))
    .slice(0, limit);
}
