import { watch, type FSWatcher } from "node:fs";
import { join } from "node:path";
import { HISTORY_DIR } from "./runrecord.js";

// Watches .testfile/runs/ for changes - runs recorded by other processes
// (e.g. a plain `testfile start` in another terminal) show up in the TUI's
// runs and results views without restarting it. The folder may not exist
// yet when the TUI starts; establishing the watch is retried until it does.
// Returns a cleanup function.
export function watchRuns(baseDir: string, onChange: () => void, debounceMs = 300): () => void {
  const dir = join(baseDir, HISTORY_DIR, "runs");
  let watcher: FSWatcher | undefined;
  let debounce: NodeJS.Timeout | undefined;
  let closed = false;
  const notify = (): void => {
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(onChange, debounceMs);
  };
  const tryWatch = (): void => {
    if (closed || watcher) return;
    try {
      watcher = watch(dir, { recursive: true }, notify);
      watcher.on("error", () => {
        watcher?.close();
        watcher = undefined;
      });
      // the folder may have appeared with runs already recorded in it
      notify();
    } catch {
      // the runs folder does not exist yet; the interval below retries
    }
  };
  tryWatch();
  const retry = setInterval(tryWatch, 2000);
  return () => {
    closed = true;
    clearInterval(retry);
    if (debounce) clearTimeout(debounce);
    watcher?.close();
  };
}
