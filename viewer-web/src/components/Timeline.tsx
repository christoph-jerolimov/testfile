import React, { useMemo } from "react";
import { formatMs, variantLabel } from "../format.js";
import { timelineOf } from "../timeline.js";
import type { RunRecord } from "../types.js";

// When each test ran, on one axis: the shape of the run rather than a list
// of durations. A sequence reads as a staircase, a parallel group as a
// stack, and a merged run shows what its legs did at the same moment.
export function Timeline({
  run,
  onLog,
  selectedPath,
}: {
  run: RunRecord;
  onLog: (path: string) => void;
  selectedPath?: string;
}): React.ReactElement | null {
  const timeline = useMemo(() => timelineOf(run), [run]);
  if (!timeline) return null;
  return (
    <div className="timeline">
      <div className="timeline-axis">
        {timeline.ticks.map((tick) => (
          <span key={tick.atMs} className="timeline-tick" style={{ left: `${tick.left}%` }}>
            {formatMs(tick.atMs)}
          </span>
        ))}
      </div>
      {timeline.bars.map((bar, index) => {
        const where = variantLabel(bar.test.variants);
        return (
          <div
            key={`${bar.test.path} ${bar.test.origin ?? index}`}
            className={`timeline-row ${selectedPath === bar.test.path ? "selected" : ""}`}
          >
            <span className="timeline-name mono" title={bar.test.path}>
              {bar.test.path}
              {where ? <span className="variant">{where}</span> : null}
            </span>
            <span className="timeline-track">
              <button
                className={`timeline-bar status-${bar.test.status}`}
                style={{ left: `${bar.left}%`, width: `${bar.width}%` }}
                title={`${bar.test.path} · started ${formatMs(bar.fromMs)} into the run · took ${formatMs(bar.test.durationMs ?? 0)}`}
                aria-label={`${bar.test.path} at ${formatMs(bar.fromMs)}`}
                onClick={() => onLog(bar.test.path)}
              />
            </span>
            <span className="timeline-label">{formatMs(bar.test.durationMs ?? 0)}</span>
          </div>
        );
      })}
    </div>
  );
}
