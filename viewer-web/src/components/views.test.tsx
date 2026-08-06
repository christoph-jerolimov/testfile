import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { RunRecord, RunTest } from "../types.js";
import { ResultsView } from "./ResultsView.js";
import { RunsView } from "./RunsView.js";

// The browser side of the viewer is covered by the Playwright suite in e2e/;
// these render the views without a browser, which is enough to pin what the
// selection from the URL does.
const run = (id: string, startedAt: string, status: RunRecord["status"]): RunRecord => ({
  id,
  startedAt,
  durationMs: 100,
  status,
  exitCode: status === "passed" ? 0 : 1,
  cancelled: false,
  env: {},
  ports: {},
  selected: [],
  tests: [
    { path: "ci", status: status as RunTest["status"] },
    { path: "ci/unit", status: status as RunTest["status"] },
  ],
});

// recent, because the runs table opens on the last 30 days
const hoursAgo = (hours: number): string => new Date(Date.now() - hours * 3_600_000).toISOString();

const runs = [
  run("20260102-090000-fx02", hoursAgo(1), "failed"),
  run("20260101-120000-fx01", hoursAgo(26), "passed"),
];

test("the run from the URL is the one shown, whatever its position", () => {
  const newest = renderToStaticMarkup(<RunsView runs={runs} />);
  assert.match(newest, /run <span class="mono">20260102-090000-fx02/);

  const older = renderToStaticMarkup(<RunsView runs={runs} selected="20260101-120000-fx01" />);
  assert.match(older, /run <span class="mono">20260101-120000-fx01/);
  assert.match(older, /class="row selected"/);
});

test("an unknown run id falls back to the newest run", () => {
  const markup = renderToStaticMarkup(<RunsView runs={runs} selected="gone" />);
  assert.match(markup, /run <span class="mono">20260102-090000-fx02/);
});

test("rows link to their own route", () => {
  const markup = renderToStaticMarkup(<RunsView runs={runs} />);
  // every run is a row; the detail names the selected one
  assert.equal(markup.match(/class="row/g)?.length, 2);
});

test("a run outside the default window is hidden, but a link still opens it", () => {
  const old = run(
    "20250101-000000-old0",
    new Date(Date.now() - 120 * 86_400_000).toISOString(),
    "passed",
  );
  const markup = renderToStaticMarkup(<RunsView runs={[...runs, old]} selected={old.id} />);
  assert.match(markup, /2 of 3 runs/);
  assert.match(markup, /run <span class="mono">20250101-000000-old0/);
});

test("the results view opens the test from the URL", () => {
  const markup = renderToStaticMarkup(<ResultsView runs={runs} selected="ci/unit" />);
  assert.match(markup, /executions of <span class="mono">ci\/unit/);
  const first = renderToStaticMarkup(<ResultsView runs={runs} />);
  assert.match(first, /executions of <span class="mono">ci</);
});

test("the results table carries a history sparkline and a verdict badge", () => {
  const markup = renderToStaticMarkup(<ResultsView runs={runs} />);
  assert.match(markup, /class="spark"/);
  assert.match(markup, /aria-pressed="false">flaky only/);
  // two runs is not enough evidence to judge anything
  assert.doesNotMatch(markup, /class="badge flaky"/);
  assert.doesNotMatch(markup, /class="badge broken"/);

  // 12 runs: ci alternates, ci/unit fails all but the first
  const judged = Array.from({ length: 12 }, (_, i) =>
    run(`2026010${i}-000000-fx`, hoursAgo(i + 1), i % 2 === 0 ? "failed" : "passed"),
  );
  for (const [index, record] of judged.entries()) {
    record.tests = [
      { path: "ci", status: index % 2 === 0 ? "failed" : "passed" },
      { path: "ci/unit", status: index === 0 ? "passed" : "failed" },
    ];
  }
  const verdicts = renderToStaticMarkup(<ResultsView runs={judged} />);
  // ci is flaky: one row plus the heading, since it is the selected test
  assert.equal(verdicts.match(/class="badge flaky"/g)?.length, 2);
  assert.equal(verdicts.match(/class="badge broken"/g)?.length, 1, "ci/unit, in its row");
});

test("a run detail offers the runs it can be compared with", () => {
  const markup = renderToStaticMarkup(<RunsView runs={runs} />);
  assert.match(markup, /aria-label="compare with"/);
  // the other run is offered, this one is not
  assert.match(markup, /<option value="20260101-120000-fx01"/);
  assert.doesNotMatch(markup, /<option value="20260102-090000-fx02"/);
  // nothing is compared until one is picked
  assert.doesNotMatch(markup, /class="diff"/);
});

test("a lone run has nothing to compare against", () => {
  const markup = renderToStaticMarkup(<RunsView runs={[runs[0]]} />);
  assert.doesNotMatch(markup, /aria-label="compare with"/);
});

test("every column of both tables is a sort button", () => {
  const runsMarkup = renderToStaticMarkup(<RunsView runs={runs} />);
  // Started, Status, Duration, Tests - no variants in this fixture
  assert.equal(runsMarkup.match(/class="sort /g)?.length, 4);
  assert.match(runsMarkup, /aria-sort="descending"/, "newest run first to begin with");
  assert.match(runsMarkup, /title="sort by startedAt"/);

  const resultsMarkup = renderToStaticMarkup(<ResultsView runs={runs} />);
  // the list table (6) plus the executions table (5)
  assert.equal(resultsMarkup.match(/class="sort /g)?.length, 11);
  assert.match(resultsMarkup, /aria-sort="ascending"/, "tests read by path to begin with");
});

test("without runs both views say so instead of crashing", () => {
  assert.match(renderToStaticMarkup(<RunsView runs={[]} />), /no recorded runs yet/);
  assert.match(renderToStaticMarkup(<ResultsView runs={[]} />), /no recorded runs yet/);
});
