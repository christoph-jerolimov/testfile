// What a sync narrates while it works: what it is about to do, how many
// archives it found, and where it currently is. The backends emit events;
// how they are rendered is the caller's business - the CLI prints lines
// (updating in place on a TTY), tests record them, everything else passes
// nothing and stays silent.

export interface SyncProgress {
  // Something worth saying that is not an archive: "listing the last 100
  // workflow runs of owner/repo".
  note(message: string): void;
  // The plan, once it is known: how many archives will be fetched.
  plan(total: number, what: string): void;
  // Archive `index` of `total` is being downloaded.
  fetching(index: number, total: number, label: string): void;
  // ... and what it yielded once imported.
  fetched(index: number, total: number, label: string, imported: number, skipped: number): void;
}

export function noProgress(): SyncProgress {
  return { note() {}, plan() {}, fetching() {}, fetched() {} };
}

// Minimal stream shape, so tests can hand in a recorder.
export interface ProgressStream {
  isTTY?: boolean;
  write(text: string): unknown;
}

const ESC = String.fromCharCode(27);

function yielded(imported: number, skipped: number): string {
  const parts: string[] = [];
  if (imported > 0) parts.push(`${imported} imported`);
  if (skipped > 0) parts.push(`${skipped} already known`);
  return parts.length > 0 ? parts.join(", ") : "nothing new";
}

// One line per event; on a TTY the in-flight download updates in place, so
// a long sync reads as a progress line rather than a wall of text.
export function lineProgress(stream: ProgressStream = process.stderr): SyncProgress {
  const live = stream.isTTY === true;
  const update = (text: string): void => {
    if (live) stream.write(`\r${ESC}[2K${text}`);
    else stream.write(`${text}\n`);
  };
  const settle = (text: string): void => {
    if (live) stream.write(`\r${ESC}[2K${text}\n`);
    else stream.write(`${text}\n`);
  };
  return {
    note(message) {
      settle(message);
    },
    plan(total, what) {
      settle(total === 0 ? `nothing to fetch - ${what}` : `${total} ${what}`);
    },
    fetching(index, total, label) {
      update(`[${index}/${total}] ${label} ...`);
    },
    fetched(index, total, label, imported, skipped) {
      settle(`[${index}/${total}] ${label} - ${yielded(imported, skipped)}`);
    },
  };
}
