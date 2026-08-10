import React, { useEffect, useState } from "react";
import { fileUrl, serviceLogUrl, testLogUrl } from "../api.js";
import { formatMs, startedLabel, variantLabel } from "../format.js";
import { navigate } from "../router.js";
import { relatedServices } from "../suite.js";
import type { RunRecord, RunTest } from "../types.js";
import { Log } from "./Log.js";
import { StatusCell } from "./StatusCell.js";

// Which tab of the test page is open: the overview, the test's own log, or
// one of the related services' logs - the same tabs the TUI's test page has.
type Tab = { kind: "overview" } | { kind: "log" } | { kind: "service"; name: string };

function Overview({ run, results }: { run: RunRecord; results: RunTest[] }): React.ReactElement {
  return (
    <>
      {results.map((test, index) => (
        <div key={index} className="meta">
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
          {variantLabel(test.variants) ? (
            <>
              {" "}
              · <span className="variant">{variantLabel(test.variants)}</span>
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
  // A merged run holds one result per leg, so a path can have several.
  const results = run.tests.filter((test) => test.path === testPath);
  const services = relatedServices(run, testPath);
  const logUrl =
    tab.kind === "service" ? serviceLogUrl(run.id, tab.name) : testLogUrl(run.id, testPath);
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
        <button
          className={tab.kind === "log" ? "active" : ""}
          onClick={() => setTab({ kind: "log" })}
        >
          Test log
        </button>
        {services.map((service) => (
          <button
            key={service.name}
            className={tab.kind === "service" && tab.name === service.name ? "active" : ""}
            disabled={!service.log}
            onClick={() => setTab({ kind: "service", name: service.name })}
          >
            service {service.name}
          </button>
        ))}
      </nav>
      {tab.kind === "overview" ? (
        results.length === 0 ? (
          <div className="empty">not executed in this run</div>
        ) : (
          <Overview run={run} results={results} />
        )
      ) : (
        <Log url={logUrl} revision={revision} />
      )}
    </main>
  );
}
