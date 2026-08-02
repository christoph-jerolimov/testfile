import React, { useEffect, useState } from "react";
import { runLogUrl, serviceLogUrl, testLogUrl } from "../api.js";
import { formatMs, startedLabel } from "../format.js";
import type { RunRecord } from "../types.js";
import { Log } from "./Log.js";
import { StatusCell } from "./StatusCell.js";

type LogChoice = { kind: "run" } | { kind: "test"; path: string } | { kind: "service"; name: string };

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
      </div>
      <table>
        <thead>
          <tr>
            <th>Test</th>
            <th>Status</th>
            <th>Duration</th>
            <th>Log</th>
          </tr>
        </thead>
        <tbody>
          {run.tests.map((test) => (
            <tr
              key={test.path}
              className={choice.kind === "test" && choice.path === test.path ? "selected" : undefined}
            >
              <td className="mono">{test.path}</td>
              <td>
                <StatusCell status={test.status} cached={test.cached} />
              </td>
              <td>{formatMs(test.durationMs)}</td>
              <td>
                {test.log ? (
                  <button className="link" onClick={() => setChoice({ kind: "test", path: test.path })}>
                    show
                  </button>
                ) : (
                  <span className="status-skipped">-</span>
                )}
                {test.artifacts?.length ? (
                  <span className="badge">{test.artifacts.length} artifacts</span>
                ) : null}
              </td>
            </tr>
          ))}
          {(run.services ?? []).map((service) => (
            <tr
              key={`svc-${service.name}`}
              className={choice.kind === "service" && choice.name === service.name ? "selected" : undefined}
            >
              <td className="mono">service {service.name}</td>
              <td>
                <StatusCell status={service.status ?? "stopped"} />
              </td>
              <td>-</td>
              <td>
                {service.log ? (
                  <button className="link" onClick={() => setChoice({ kind: "service", name: service.name })}>
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
      <h2 style={{ marginTop: "1.2rem" }}>
        {choice.kind === "run" ? (
          "merged log"
        ) : (
          <>
            log of{" "}
            <span className="mono">{choice.kind === "test" ? choice.path : `service ${choice.name}`}</span>{" "}
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
