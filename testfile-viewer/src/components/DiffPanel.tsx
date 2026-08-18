import React, { useMemo } from "react";
import { diffRuns, diffTotal } from "../diff.js";
import { formatMs } from "../format.js";
import type { RunRecord } from "../types.js";

// The same six sections `testfile-viewer diff` prints, in the same order:
// what broke first, then what recovered, then what merely moved.
function Section({ title, paths }: { title: string; paths: string[] }): React.ReactElement | null {
  if (paths.length === 0) return null;
  return (
    <div className="diff-section">
      <span className="diff-title">
        {title} ({paths.length})
      </span>
      <ul>
        {paths.map((path) => (
          <li key={path} className="mono">
            {path}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function DiffPanel({
  base,
  compare,
}: {
  base: RunRecord;
  compare: RunRecord;
}): React.ReactElement {
  const diff = useMemo(() => diffRuns(base, compare), [base, compare]);
  if (diffTotal(diff) === 0) {
    return (
      <div className="diff">
        <div className="muted small">
          nothing changed against <span className="mono">{base.id}</span>
        </div>
      </div>
    );
  }
  return (
    <div className="diff">
      <div className="diff-grid">
        <Section title="newly failed" paths={diff.newlyFailed} />
        <Section title="still failing" paths={diff.stillFailing} />
        <Section title="fixed" paths={diff.fixed} />
        <Section title="added" paths={diff.added} />
        <Section title="removed" paths={diff.removed} />
        {diff.durations.length > 0 ? (
          <div className="diff-section">
            <span className="diff-title">duration ({diff.durations.length})</span>
            <ul>
              {diff.durations.map((entry) => (
                <li key={entry.path} className="mono">
                  {entry.path}{" "}
                  <span className={entry.toMs > entry.fromMs ? "slower" : "faster"}>
                    {formatMs(entry.fromMs)} → {formatMs(entry.toMs)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </div>
  );
}
