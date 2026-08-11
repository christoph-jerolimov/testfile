import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { RunRecord, RunTest } from "../types.js";
import { TestsView } from "./TestsView.js";
import { RunsView } from "./RunsView.js";
import { TestView } from "./TestView.js";

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

test("the tests view opens the test from the URL", () => {
  const markup = renderToStaticMarkup(<TestsView runs={runs} selected="ci/unit" />);
  assert.match(markup, /executions of <span class="mono">ci\/unit/);
  // no path in the URL means the "All tests" row is what shows
  const all = renderToStaticMarkup(<TestsView runs={runs} />);
  assert.match(all, /executions of <span class="mono">all tests/);
  assert.match(all, /class="all-tests-row selected"/);
  assert.match(all, />Test</, "the executions table gains a Test column");
});

test("the tests table carries a history sparkline and a verdict badge", () => {
  const markup = renderToStaticMarkup(<TestsView runs={runs} />);
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
  const verdicts = renderToStaticMarkup(<TestsView runs={judged} selected="ci" />);
  // ci is flaky: one row plus the heading, since it is the selected test
  assert.equal(verdicts.match(/class="badge flaky"/g)?.length, 2);
  assert.equal(verdicts.match(/class="badge broken"/g)?.length, 1, "ci/unit, in its row");
});

test("a label key with many values becomes a dropdown, few stay chips", () => {
  const labelled = Array.from({ length: 5 }, (_, i) => {
    const record = run(`2026010${i}-000000-lb`, hoursAgo(i + 1), "passed");
    record.labels = { branch: `feature-${i}`, tier: i % 2 === 0 ? "nightly" : "hourly" };
    return record;
  });
  const markup = renderToStaticMarkup(<RunsView runs={labelled} />);
  // 5 branch values: one dropdown with an "any" entry and every value
  assert.match(markup, /aria-label="filter by branch"/);
  assert.match(markup, /branch: any<\/option>/);
  assert.match(markup, /<option value="branch=feature-0"/);
  assert.doesNotMatch(markup, /aria-pressed="false">branch=feature-0/, "no chip per branch");
  // 2 tier values: chips, no dropdown
  assert.match(markup, /aria-pressed="false">tier=nightly/);
  assert.doesNotMatch(markup, /aria-label="filter by tier"/);
});

test("a merged run tabs one log per leg and its overview repeats the labels", () => {
  const record = { ...runs[1] };
  record.labels = { branch: "main" };
  record.tests = [
    {
      path: "ci/unit",
      status: "passed",
      log: "tests/20260101-linux/ci-unit.log",
      variants: { platform: "linux" },
    },
    {
      path: "ci/unit",
      status: "failed",
      log: "tests/20260101-windows/ci-unit.log",
      variants: { platform: "windows" },
    },
  ];
  record.services = [
    {
      name: "db",
      status: "stopped",
      log: "services/20260101-linux/db.log",
      variants: { platform: "linux" },
    },
    {
      name: "db",
      status: "stopped",
      log: "services/20260101-windows/db.log",
      variants: { platform: "windows" },
    },
  ];
  const markup = renderToStaticMarkup(
    <TestView runs={[record]} runId={record.id} testPath="ci/unit" />,
  );
  assert.match(markup, /Test log \(platform=linux\)<\/button>/);
  assert.match(markup, /Test log \(platform=windows\)<\/button>/);
  assert.match(markup, /service db \(platform=linux\)<\/button>/);
  assert.match(markup, /service db \(platform=windows\)<\/button>/);
  // the overview repeats the run's labels and tails each leg's log
  assert.match(markup, /class="badge label"/);
  assert.match(markup, /branch=main/);
  assert.equal(markup.match(/class="log wrap tail"/g)?.length, 2, "one excerpt per leg");
});

test("an analysis appears on the run, said to be somebody's reading of it", () => {
  const annotated = { ...runs[0] };
  annotated.analysis = {
    text: "Port 5432 collides in the parallel group. Not this change.",
    author: "claude-code",
  };
  const markup = renderToStaticMarkup(<RunsView runs={[annotated, runs[1]]} />);
  assert.match(markup, /class="analysis"/);
  assert.match(markup, /analysis, added after the run by claude-code/);
  assert.match(markup, /Port 5432 collides/);

  // a run without one shows nothing at all
  assert.doesNotMatch(renderToStaticMarkup(<RunsView runs={runs} />), /class="analysis"/);
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
  // Started, Run, Status, Duration, Passed, Failed, Others - no variants
  // in this fixture
  assert.equal(runsMarkup.match(/class="sort /g)?.length, 7);
  assert.match(runsMarkup, /aria-sort="descending"/, "newest run first to begin with");
  assert.match(runsMarkup, /title="sort by startedAt"/);

  const resultsMarkup = renderToStaticMarkup(<TestsView runs={runs} />);
  // the list table (6) plus the all-tests executions table (6)
  assert.equal(resultsMarkup.match(/class="sort /g)?.length, 12);
  assert.match(resultsMarkup, /aria-sort="ascending"/, "tests read by path to begin with");
});

test("without runs both views say so instead of crashing", () => {
  assert.match(renderToStaticMarkup(<RunsView runs={[]} />), /no recorded runs yet/);
  assert.match(renderToStaticMarkup(<TestsView runs={[]} />), /no recorded runs yet/);
});

test("the test page breadcrumbs its way back and tabs its logs", () => {
  const record = { ...runs[0] };
  record.services = [{ name: "db", status: "stopped", log: "services/db.log" }];
  const markup = renderToStaticMarkup(
    <TestView runs={[record]} runId={record.id} testPath="ci/unit" />,
  );
  assert.match(markup, /class="breadcrumb"/);
  assert.match(markup, /Tests<\/button>/);
  assert.match(markup, /class="tabs"/);
  assert.match(markup, /Overview<\/button>/);
  assert.match(markup, /Test log<\/button>/);
  assert.match(markup, /service db<\/button>/, "one tab per related service");

  // a stale link degrades into words, not a crash
  const gone = renderToStaticMarkup(<TestView runs={[record]} runId="gone" testPath="ci/unit" />);
  assert.match(gone, /no longer recorded/);
  const missing = renderToStaticMarkup(
    <TestView runs={[record]} runId={record.id} testPath="ci/nope" />,
  );
  assert.match(missing, /not executed in this run/);
});
