import { createHash } from "node:crypto";
import { globSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { groupByPattern } from "./gitchanges.js";
import { HISTORY_DIR } from "./history.js";

export interface CacheEntry {
  hash: string;
  savedAt: string;
  // Per-file content hashes at save time, so a later miss can explain which
  // files changed. Entries written by older runners lack it.
  files?: Record<string, string>;
}

// The current state of a test's inputs: the aggregate hash compared against
// the cache, plus the per-file hashes stored with fresh results.
export interface InputsState {
  hash: string;
  files: Record<string, string>;
}

// Stores, per test configuration, the inputs hash of the last passing run in
// .testfile/cache.json. A test whose configuration and inputs are unchanged
// can skip re-running. With enabled=false (--no-cache) stored entries are
// ignored but fresh results still refresh the cache.
export class ResultCache {
  readonly file: string;
  private entries: Record<string, CacheEntry> = {};
  private dirty = false;

  constructor(
    baseDir: string,
    readonly enabled = true
  ) {
    this.file = join(baseDir, HISTORY_DIR, "cache.json");
    try {
      this.entries = JSON.parse(readFileSync(this.file, "utf8")) as Record<string, CacheEntry>;
    } catch {
      // no cache yet
    }
  }

  // Identity of a test's configuration: its path, resolved command/script,
  // resolved own env and matrix combination. Any change yields a new key.
  static configKey(
    path: string,
    source: string,
    env: Record<string, string>,
    matrix: Record<string, string>
  ): string {
    const hash = createHash("sha256");
    hash.update(JSON.stringify([path, source, sorted(env), sorted(matrix)]));
    return hash.digest("hex");
  }

  // Content hash of every file matching the globs: file identity and bytes.
  static inputsHash(cwd: string, globs: string[]): string {
    return ResultCache.inputsState(cwd, globs).hash;
  }

  // Like inputsHash, but also returns each file's own content hash (the
  // aggregate uses the same bytes as before, so existing caches stay valid).
  static inputsState(cwd: string, globs: string[]): InputsState {
    const hash = createHash("sha256");
    const perFile: Record<string, string> = {};
    const files = globSync(globs, { cwd }).sort();
    let counted = 0;
    for (const relative of files) {
      try {
        const absolute = join(cwd, relative);
        if (!statSync(absolute).isFile()) continue;
        counted++;
        const content = readFileSync(absolute);
        hash.update(relative);
        hash.update("\0");
        hash.update(content);
        hash.update("\0");
        perFile[relative] = createHash("sha256").update(content).digest("hex");
      } catch {
        // a file vanished between glob and read; treat as absent
      }
    }
    return { hash: `${counted}:${hash.digest("hex")}`, files: perFile };
  }

  get(key: string): CacheEntry | undefined {
    return this.enabled ? this.entries[key] : undefined;
  }

  put(key: string, state: InputsState): void {
    this.entries[key] = { hash: state.hash, savedAt: new Date().toISOString(), files: state.files };
    this.dirty = true;
  }

  invalidate(key: string): void {
    if (key in this.entries) {
      delete this.entries[key];
      this.dirty = true;
    }
  }

  flush(): void {
    if (!this.dirty) return;
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(join(dirname(this.file), ".gitignore"), "*\n");
    writeFileSync(this.file, `${JSON.stringify(this.entries, null, 2)}\n`);
    this.dirty = false;
  }
}

function sorted(map: Record<string, string>): [string, string][] {
  return Object.entries(map).sort(([a], [b]) => a.localeCompare(b));
}

// Why a stored result could not be reused: which input pattern saw changed
// (edited, added or removed) files, with names for small sets. Entries from
// older runners carry no per-file hashes, so they can't say more than
// "changed".
export function explainInputsMiss(
  entry: CacheEntry,
  current: InputsState,
  patterns: readonly string[]
): string {
  if (!entry.files) return "inputs changed (no per-file detail in the stored entry)";
  const changed: string[] = [];
  for (const [file, hash] of Object.entries(current.files)) {
    const previous = entry.files[file];
    if (previous === undefined || previous !== hash) changed.push(file);
  }
  for (const file of Object.keys(entry.files)) {
    if (!(file in current.files)) changed.push(`${file} (removed)`);
  }
  if (changed.length === 0) return "inputs changed";
  const groups = groupByPattern(changed, patterns);
  // removed files no longer match any glob; report them without a pattern
  const grouped = new Set(groups.flatMap((group) => group.files));
  const ungrouped = changed.filter((file) => !grouped.has(file));
  const parts = groups.map(({ pattern, files }) => {
    const count = `${files.length} changed file${files.length === 1 ? "" : "s"}`;
    return files.length < 4 ? `${pattern}: ${count} (${files.join(", ")})` : `${pattern}: ${count}`;
  });
  if (ungrouped.length > 0) {
    parts.push(ungrouped.length < 4 ? ungrouped.join(", ") : `${ungrouped.length} files removed`);
  }
  return parts.join("; ");
}
