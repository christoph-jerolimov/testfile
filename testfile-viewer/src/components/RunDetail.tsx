import React, { useEffect, useState } from "react";
import { fileUrl, runLogUrl, serviceLogUrl, testLogUrl } from "../api.js";
import { previousRun } from "../diff.js";
import { formatMs, mergedVariantLabel, startedLabel, variantLabel } from "../format.js";
import { navigate } from "../router.js";
import type { RunRecord } from "../types.js";
import { DiffPanel } from "./DiffPanel.js";
import { Log } from "./Log.js";
import { StatusCell } from "./StatusCell.js";
import { SuiteTree } from "./SuiteTree.js";
import { Timeline } from "./Timeline.js";

type LogChoice =
  | { kind: "run" }
  | { kind: "test"; path: string }
  | { kind: "service"; name: string };

export function RunDetail({
  run,
  runs = [],
}: {
  run: RunRecord;
  // Every recorded run, so this one can be compared against another.
  runs?: RunRecord[];
  // Counts the server's change pings, so an open log is re-read.
}): React.ReactElement {
  const [choice, setChoice] = useState<LogChoice>({ kind: "run" });
  // A comparison belongs to the run it was opened on; picking another run
  // starts from no comparison again.
  const [baseId, setBaseId] = useState<string>("");
  useEffect(() => {
    setChoice({ kind: "run" });
    setBaseId("");
  }, [run.id]);
  const others = runs.filter((candidate) => candidate.id !== run.id);
  const previous = previousRun(runs, run);
  const base = others.find((candidate) => candidate.id === baseId);
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
      {/* What the run was labelled with - the branch, the pull request,
          whoever started it - so a run can be placed without opening it. */}
      {Object.keys(run.labels ?? {}).length > 0 ? (
        <div className="labels">
          {Object.entries(run.labels ?? {}).map(([key, value]) => (
            <span key={key} className="badge label">
              {key}={value}
            </span>
          ))}
        </div>
      ) : null}
      {/* What the environment added on top of the committed Testfile:
          variables it handed in, the secrets that were in play, and the
          values it rewrote. Without this the run and the file disagree and
          nothing says why. */}
      {run.fromEnvironment ? (
        <div className="from-environment">
          <div className="muted small">from the environment</div>
          {(run.fromEnvironment.variables ?? []).map((name) => (
            <span key={name} className="badge given">
              {name}
            </span>
          ))}
          {(run.fromEnvironment.secrets ?? []).map((name) => (
            <span key={name} className="badge secret" title="value masked everywhere">
              {name}
            </span>
          ))}
          {(run.fromEnvironment.overrides ?? []).map((override) => (
            <span key={override.path} className="badge override" title={override.from}>
              {override.path}={override.value}
            </span>
          ))}
        </div>
      ) : null}
      {/* Somebody's reading of the run, added after it happened. Marked as
          an opinion, because it sits next to facts and is not one. */}
      {run.analysis ? (
        <div className="analysis">
          <div className="muted small">
            analysis, added after the run
            {run.analysis.author ? ` by ${run.analysis.author}` : ""}
          </div>
          <p>{run.analysis.text.trimEnd()}</p>
        </div>
      ) : null}
      {/* The run folder itself: the record it was read from, and the JUnit
          report when the run wrote one. */}
      <div className="files">
        <a
          className="badge file"
          href={fileUrl(run.id, "run.yaml")}
          target="_blank"
          rel="noreferrer"
        >
          run.yaml
        </a>
        {run.junit ? (
          <a
            className="badge file"
            href={fileUrl(run.id, run.junit)}
            target="_blank"
            rel="noreferrer"
          >
            {run.junit}
          </a>
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
      {others.length > 0 ? (
        <div className="compare">
          <label>
            compare with{" "}
            <select
              className="compare-pick"
              aria-label="compare with"
              value={baseId}
              onChange={(event) => setBaseId(event.target.value)}
            >
              <option value="">nothing</option>
              {others.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {startedLabel(candidate.startedAt)} · {candidate.status} · {candidate.id}
                </option>
              ))}
            </select>
          </label>
          {previous && baseId !== previous.id ? (
            <button className="link" onClick={() => setBaseId(previous.id)}>
              previous run
            </button>
          ) : null}
        </div>
      ) : null}
      {base ? <DiffPanel base={base} compare={run} /> : null}
      <Timeline
        run={run}
        selectedPath={choice.kind === "test" ? choice.path : undefined}
        onLog={(path) => setChoice({ kind: "test", path })}
      />
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
            {choice.kind === "test" ? (
              <button
                className="link"
                onClick={() => navigate({ view: "test", runId: run.id, testPath: choice.path })}
              >
                (open test page)
              </button>
            ) : null}
          </>
        )}
      </h2>
      <Log url={logUrl} />
    </>
  );
}
