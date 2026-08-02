import React from "react";

export function StatusCell({ status, cached }: { status: string; cached?: boolean }): React.ReactElement {
  const glyph =
    status === "passed"
      ? "✔"
      : status === "failed" || status === "aborted"
        ? "✘"
        : status === "skipped"
          ? "↷"
          : "·";
  return (
    <span className={`status-${status}`}>
      {glyph} {status}
      {cached ? <span className="badge">cached</span> : null}
    </span>
  );
}
