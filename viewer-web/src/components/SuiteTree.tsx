import React, { useMemo, useState } from "react";
import { fileName, fileUrl } from "../api.js";
import { formatMs, variantLabel } from "../format.js";
import { groupPaths, suiteRowsOf, visibleRows, type TreeRow } from "../suite.js";
import type { RunRecord, RunTest } from "../types.js";
import { StatusCell } from "./StatusCell.js";

// One line per suite node: the tree the Testfile describes, with the results
// of this run on it. A node the run never reached keeps its place, greyed.
function RowCells({
  row,
  runId,
  result,
  onLog,
  selected,
}: {
  row: TreeRow;
  runId: string;
  result?: RunTest;
  onLog: (path: string) => void;
  selected: boolean;
}): React.ReactElement {
  return (
    <>
      <td>
        <StatusCell status={result?.status ?? "not run"} cached={result?.cached} />
      </td>
      <td>{formatMs(result?.durationMs)}</td>
      <td>
        {result?.log ? (
          <button className={`link ${selected ? "on" : ""}`} onClick={() => onLog(row.path)}>
            show
          </button>
        ) : (
          <span className="status-skipped">-</span>
        )}
        {/* what the test kept: each one opens from the run folder */}
        {(result?.artifacts ?? []).map((artifact) => (
          <a
            key={artifact}
            className="badge file"
            href={fileUrl(runId, artifact)}
            title={artifact}
            target="_blank"
            rel="noreferrer"
          >
            {fileName(artifact)}
          </a>
        ))}
      </td>
    </>
  );
}

export function SuiteTree({
  run,
  onLog,
  selectedPath,
}: {
  run: RunRecord;
  onLog: (path: string) => void;
  selectedPath?: string;
}): React.ReactElement {
  const rows = useMemo(() => suiteRowsOf(run), [run]);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const shown = useMemo(() => visibleRows(rows, collapsed), [rows, collapsed]);
  const groups = useMemo(() => groupPaths(rows), [rows]);

  const toggle = (path: string): void => {
    const next = new Set(collapsed);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    setCollapsed(next);
  };

  return (
    <>
      {groups.length > 0 ? (
        <div className="tree-controls">
          <button className="link" onClick={() => setCollapsed(new Set(groups))}>
            collapse all
          </button>
          <button className="link" onClick={() => setCollapsed(new Set())}>
            expand all
          </button>
        </div>
      ) : null}
      <table className="tree">
        <thead>
          <tr>
            <th>Test</th>
            <th>Status</th>
            <th>Duration</th>
            <th>Log</th>
          </tr>
        </thead>
        <tbody>
          {shown.flatMap((row) => {
            // A merged run has one result per leg; each gets its own line
            // under the node, tagged with the variants it came from.
            const results = row.results.length > 0 ? row.results : [undefined];
            return results.map((result, index) => {
              const selected = selectedPath === row.path;
              return (
                <tr
                  key={`${row.path} ${result?.origin ?? index}`}
                  className={`${selected ? "selected" : ""} ${row.notRun ? "not-run" : ""}`}
                >
                  <td className="mono">
                    <span className="tree-name" style={{ paddingLeft: `${row.depth * 1.1}rem` }}>
                      {row.hasChildren && index === 0 ? (
                        <button
                          className="twisty"
                          aria-expanded={!collapsed.has(row.path)}
                          aria-label={`${collapsed.has(row.path) ? "expand" : "collapse"} ${row.path}`}
                          onClick={() => toggle(row.path)}
                        >
                          {collapsed.has(row.path) ? "▸" : "▾"}
                        </button>
                      ) : (
                        <span className="twisty-spacer" />
                      )}
                      {row.name}
                    </span>
                    {row.kind && row.kind !== "command" ? (
                      <span className="badge kind">{row.kind}</span>
                    ) : null}
                    {(row.tags ?? []).map((tag) => (
                      <span key={tag} className="badge">
                        {tag}
                      </span>
                    ))}
                    {Object.entries(row.matrix ?? {}).map(([key, value]) => (
                      <span key={key} className="variant">
                        {key}={value}
                      </span>
                    ))}
                    {(row.services ?? []).map((service) => (
                      <span key={service} className="badge service">
                        service {service}
                      </span>
                    ))}
                    {result && variantLabel(result.variants) ? (
                      <span className="variant">{variantLabel(result.variants)}</span>
                    ) : null}
                    {result?.reason ? <div className="muted small">{result.reason}</div> : null}
                  </td>
                  <RowCells
                    row={row}
                    runId={run.id}
                    result={result}
                    onLog={onLog}
                    selected={selected}
                  />
                </tr>
              );
            });
          })}
        </tbody>
      </table>
    </>
  );
}
