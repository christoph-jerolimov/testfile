import React, { useEffect, useState } from "react";
import { runLogUrl, serviceLogUrl, testLogUrl } from "../api.js";
import { formatMs, mergedVariantLabel, startedLabel, variantLabel } from "../format.js";
import type { RunRecord } from "../types.js";
import { Log } from "./Log.js";
import { StatusCell } from "./StatusCell.js";
import { SuiteTree } from "./SuiteTree.js";

type LogChoice =
  | { kind: "run" }
  | { kind: "test"; path: string }
  | { kind: "service"; name: string };

export function RunDetail({ run }: { run: RunRecord }): React.ReactElement {
  const [choice, setChoice] = useState<LogChoice>({ kind: "run" });
  useEffect(() => setChoice({ kind: "run" }), [run.id]);
  const logUrl =
    choice.kind === "test"
      ? testLogUrl(run.id, choice.path)
      : choice.kind === "service"
        ? serviceLogUrl(run.id, choice.name)
        : runLogUrl(run.id);
  return (
    <>
      <h2>
        run <span className="mono">{run.id}</span>
      </h2>
      <div className="meta">
        <StatusCell status={run.status} /> · started <b>{startedLabel(run.startedAt)}</b> · took{" "}
        <b>{formatMs(run.durationMs)}</b> · exit code <b>{run.exitCode}</b>
        {run.cancelled ? " · cancelled" : ""}
        {run.selected.length > 0 ? (
          <>
            {" "}
            · selected <b>{run.selected.join(", ")}</b>
          </>
        ) : null}
        {variantLabel(run.variants) ? (
          <>
            {" "}
            · <span className="variant">{variantLabel(run.variants)}</span>
          </>
        ) : null}
      </div>
      {run.merged ? (
        <div className="merged">
          merged from <b>{run.merged.runs.length}</b> runs
          {mergedVariantLabel(run.merged.variants)
            ? ` · ${mergedVariantLabel(run.merged.variants)}`
            : ""}
          <ul>
            {run.merged.runs.map((source) => (
              <li key={source.id}>
                <StatusCell status={source.status} /> <span className="mono">{source.id}</span>
                {variantLabel(source.variants) ? (
                  <span className="variant">{variantLabel(source.variants)}</span>
                ) : null}
                {source.machine ? <span className="muted small"> {source.machine}</span> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <SuiteTree
        run={run}
        selectedPath={choice.kind === "test" ? choice.path : undefined}
        onLog={(path) => setChoice({ kind: "test", path })}
      />
      {(run.services ?? []).length > 0 ? (
        <table className="services">
          <thead>
            <tr>
              <th>Service</th>
              <th>Status</th>
              <th>Log</th>
            </tr>
          </thead>
          <tbody>
            {(run.services ?? []).map((service) => (
              <tr
                key={`svc-${service.name}`}
                className={
                  choice.kind === "service" && choice.name === service.name ? "selected" : undefined
                }
              >
                <td className="mono">
                  service {service.name}
                  {variantLabel(service.variants) ? (
                    <span className="variant">{variantLabel(service.variants)}</span>
                  ) : null}
                </td>
                <td>
                  <StatusCell status={service.status ?? "stopped"} />
                </td>
                <td>
                  {service.log ? (
                    <button
                      className="link"
                      onClick={() => setChoice({ kind: "service", name: service.name })}
                    >
                      show
                    </button>
                  ) : (
                    <span className="status-skipped">-</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      <h2 style={{ marginTop: "1.2rem" }}>
        {choice.kind === "run" ? (
          "merged log"
        ) : (
          <>
            log of{" "}
            <span className="mono">
              {choice.kind === "test" ? choice.path : `service ${choice.name}`}
            </span>{" "}
            <button className="link" onClick={() => setChoice({ kind: "run" })}>
              (show merged log)
            </button>
          </>
        )}
      </h2>
      <Log url={logUrl} />
    </>
  );
}
