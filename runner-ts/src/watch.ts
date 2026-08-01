import { watch, type FSWatcher } from "node:fs";

const IGNORED_SEGMENTS = new Set([".git", "node_modules", ".testfile"]);

export function isIgnoredPath(path: string): boolean {
  return path.split(/[\\/]/).some((segment) => IGNORED_SEGMENTS.has(segment));
}

// Debounces bursts of file events into a single trigger, and defers triggers
// that arrive while a run is still in progress until it finished.
export class WatchScheduler {
  private timer?: NodeJS.Timeout;
  private pending = false;

  constructor(
    private readonly options: {
      debounceMs: number;
      isRunning: () => boolean;
      trigger: () => void;
    }
  ) {}

  notify(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.fire(), this.options.debounceMs);
  }

  // Call when a run completed; fires a deferred trigger.
  runFinished(): void {
    if (this.pending) {
      this.pending = false;
      this.options.trigger();
    }
  }

  close(): void {
    if (this.timer) clearTimeout(this.timer);
    this.pending = false;
  }

  private fire(): void {
    if (this.options.isRunning()) this.pending = true;
    else this.options.trigger();
  }
}

export function watchDirectory(dir: string, onChange: (file: string) => void): FSWatcher {
  return watch(dir, { recursive: true }, (_event, filename) => {
    if (filename && !isIgnoredPath(filename)) onChange(filename);
  });
}
