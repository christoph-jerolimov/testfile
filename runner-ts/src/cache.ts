import { createHash } from "node:crypto";
import { globSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { HISTORY_DIR } from "./history.js";

export interface CacheEntry {
  hash: string;
  savedAt: string;
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
    const hash = createHash("sha256");
    const files = globSync(globs, { cwd }).sort();
    let counted = 0;
    for (const relative of files) {
      try {
        const absolute = join(cwd, relative);
        if (!statSync(absolute).isFile()) continue;
        counted++;
        hash.update(relative);
        hash.update("\0");
        hash.update(readFileSync(absolute));
        hash.update("\0");
      } catch {
        // a file vanished between glob and read; treat as absent
      }
    }
    return `${counted}:${hash.digest("hex")}`;
  }

  get(key: string): CacheEntry | undefined {
    return this.enabled ? this.entries[key] : undefined;
  }

  put(key: string, hash: string): void {
    this.entries[key] = { hash, savedAt: new Date().toISOString() };
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
