import React from "react";

// One block per recorded run, newest on the right - the shape of a test's
// history at a glance: a flaky test alternates, a broken one has a run of
// red at the end.
export function Sparkline({
  history,
  max = 20,
}: {
  history: string[];
  max?: number;
}): React.ReactElement {
  const shown = history.slice(0, max).reverse();
  return (
    <span className="spark" title={shown.join(" → ")}>
      {shown.map((status, index) => (
        <span key={index} className={`spark-block status-${status}`} />
      ))}
    </span>
  );
}
