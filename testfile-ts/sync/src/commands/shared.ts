// Helpers the sharing commands have in common: picking the run to move,
// and saying what an import did.
import { color, HISTORY_DIR, RunHistory, type RunRecord } from "@testfile.dev/core";

// The run to operate on: an id prefix when given, the latest run otherwise.
export function pickRun(base: string, idOrPrefix: string | undefined): RunRecord {
  const history = new RunHistory(base);
  if (idOrPrefix !== undefined) {
    const run = history.find(idOrPrefix);
    if (!run) throw new Error(`no recorded run matches "${idOrPrefix}"`);
    return run;
  }
  const run = history.runs[0];
  if (!run) throw new Error(`no recorded runs in ${HISTORY_DIR}/`);
  return run;
}

export function reportImport(result: { imported: string[]; skipped: string[] }): void {
  for (const id of result.imported) console.log(`${color(32, "✔")} imported run ${id}`);
  for (const id of result.skipped) {
    console.log(color(90, `- run ${id} already exists locally, skipped`));
  }
}
