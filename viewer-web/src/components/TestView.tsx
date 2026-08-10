import React, { useEffect, useState } from "react";
import { fileUrl, serviceLogUrl, testLogUrl } from "../api.js";
import { formatMs, startedLabel, variantLabel } from "../format.js";
import { navigate } from "../router.js";
import { relatedServices } from "../suite.js";
import type { RunRecord, RunService, RunTest } from "../types.js";
import { Log } from "./Log.js";
import { StatusCell } from "./StatusCell.js";

// Which tab of the test page is open: the overview, one of the test's logs
// (a merged run has one per leg), or one of the related services' logs -
// the same tabs the TUI's test page has.
type Tab =
  | { kind: "overview" }
  | { kind: "log"; index: number }
  | { kind: "service"; index: number };

// What tells one leg's tab from another: its variants, or where it came from.
function legLabel(of: { variants?: Record<string, string>; origin?: string }): string {
  return variantLabel(of.variants) || of.origin || "";
}

// The test's own log: recorded per result, with the run-level endpoint as
// the fallback for records older than per-test logs.
function testUrl(run: RunRecord, testPath: string, result?: RunTest): string {
  return result?.log ? fileUrl(run.id, result.log) : testLogUrl(run.id, testPath);
}

function serviceUrl(run: RunRecord, service: RunService): string {
  return service.log ? fileUrl(run.id, service.log) : serviceLogUrl(run.id, service.name);
}

function Overview({
  run,
  testPath,
  results,
  revision,
}: {
  run: RunRecord;
  testPath: string;
  results: RunTest[];
  revision?: number;
}): React.ReactElement {
  return (
    <>
      {/* the run's labels again, so the page places itself without a hop back */}
      {Object.keys(run.labels ?? {}).length > 0 ? (
        <div className="labels">
          {Object.entries(run.labels ?? {}).map(([key, value]) => (
            <span key={key} className="badge label">
              {key}={value}
            </span>
          ))}
        </div>
      ) : null}
      {results.map((test, index) => (
        <React.Fragment key={index}>
          <div className="meta">
            <StatusCell status={test.status} cached={test.cached} />
            {test.startedAt ? (
              <>
                {" "}
                · started <b>{startedLabel(test.startedAt)}</b>
              </>
            ) : null}
            {test.startedAfterMs !== undefined ? (
              <>
                {" "}
                · <b>+{formatMs(test.startedAfterMs)}</b> into the run
              </>
            ) : null}
            {test.durationMs !== undefined ? (
              <>
                {" "}
                · took <b>{formatMs(test.durationMs)}</b>
              </>
            ) : null}
            {legLabel(test) ? (
              <>
                {" "}
                · <span className="variant">{legLabel(test)}</span>
              </>
            ) : null}
            {test.reason ? <> · {test.reason}</> : null}
            {(test.artifacts ?? []).map((artifact) => (
              <a
                key={artifact}
                className="badge file"
                href={fileUrl(run.id, artifact)}
                target="_blank"
                rel="noreferrer"
              >
                {artifact}
              </a>
            ))}
          </div>
          {/* the end of each leg's log, where a failure usually says why */}
          <Log url={testUrl(run, testPath, test)} revision={revision} tail={20} />
        </React.Fragment>
      ))}
    </>
  );
}

// The dedicated page of one execution: a test in a run. The breadcrumb walks
// back out; the tabs mirror the TUI's test page.
export function TestView({
  runs,
  runId,
  testPath,
  revision,
}: {
  runs: RunRecord[];
  runId: string;
  testPath: string;
  // Counts the server's change pings, so an open log is re-read.
  revision?: number;
}): React.ReactElement {
  const [tab, setTab] = useState<Tab>({ kind: "overview" });
  useEffect(() => setTab({ kind: "overview" }), [runId, testPath]);
  const run = runs.find((r) => r.id === runId);
  if (!run) {
    return (
      <main>
        <div className="empty">
          run <span className="mono">{runId}</span> is no longer recorded
        </div>
      </main>
    );
  }
  // A merged run holds one result per leg, so a path can have several -
  // each gets its own log tab, told apart by its variants.
  const results = run.tests.filter((test) => test.path === testPath);
  const logTabs = results.length > 0 ? results : [undefined];
  const services = relatedServices(run, testPath);
  const logUrl =
    tab.kind === "service"
      ? serviceUrl(run, services[tab.index] ?? { name: "" })
      : testUrl(run, testPath, tab.kind === "log" ? logTabs[tab.index] : undefined);
  return (
    <main className="single">
      <div className="breadcrumb">
        <button className="link" onClick={() => navigate({ view: "tests" })}>
          Tests
        </button>
        <span className="sep">›</span>
        <button className="link mono" onClick={() => navigate({ view: "tests", testPath })}>
          {testPath}
        </button>
        <span className="sep">›</span>
        <button className="link mono" onClick={() => navigate({ view: "runs", runId: run.id })}>
          {run.id}
        </button>
      </div>
      <h2>
        <span className="mono">{testPath}</span> in <span className="mono">{run.id}</span>
      </h2>
      <nav className="tabs">
        <button
          className={tab.kind === "overview" ? "active" : ""}
          onClick={() => setTab({ kind: "overview" })}
        >
          Overview
        </button>
        {logTabs.map((result, index) => (
          <button
            key={index}
            className={tab.kind === "log" && tab.index === index ? "active" : ""}
            onClick={() => setTab({ kind: "log", index })}
          >
            {result && legLabel(result) && logTabs.length > 1
              ? `Test log (${legLabel(result)})`
              : "Test log"}
          </button>
        ))}
        {services.map((service, index) => (
          <button
            key={index}
            className={tab.kind === "service" && tab.index === index ? "active" : ""}
            disabled={!service.log}
            onClick={() => setTab({ kind: "service", index })}
          >
            {legLabel(service)
              ? `service ${service.name} (${legLabel(service)})`
              : `service ${service.name}`}
          </button>
        ))}
      </nav>
      {tab.kind === "overview" ? (
        results.length === 0 ? (
          <div className="empty">not executed in this run</div>
        ) : (
          <Overview run={run} testPath={testPath} results={results} revision={revision} />
        )
      ) : (
        <Log url={logUrl} revision={revision} />
      )}
    </main>
  );
}
