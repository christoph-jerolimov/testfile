import { expect, test, type Page } from "@playwright/test";

// Every view is shot twice: in the dark theme the suite runs in, and once
// more with the light scheme emulated - the viewer follows the system
// preference, so both looks are pinned.
async function screenshots(page: Page, name: string): Promise<void> {
  await expect(page).toHaveScreenshot(`${name}-dark.png`);
  await page.emulateMedia({ colorScheme: "light" });
  await expect(page).toHaveScreenshot(`${name}-light.png`);
  await page.emulateMedia({ colorScheme: "dark" });
}

// Runs against the committed fixture in e2e/fixture: three recorded runs of
// an "e2e-fixture" suite - an older passing one, a newer failing one, and a
// merged run combining a linux and a windows leg.
// Functional assertions first, then a screenshot per view - compare with
// `npm run test:e2e`, refresh with `npm run test:e2e:update`.

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  // wait for data AND the SSE connection, so every screenshot shows the
  // same "● live" header state
  await expect(page.locator("header .live")).toContainText("3 runs");
  await expect(page.locator("header .live")).toContainText("live");
  // The fixture is frozen in time, so the "last 30 days" default hides it;
  // the default itself is asserted in its own test below.
  await page.getByRole("button", { name: "all", exact: true }).click();
});

test("runs view lists the history and opens the newest run", async ({ page }) => {
  await expect(page.locator("header h1")).toContainText("E2E Fixture");

  const rows = page.locator(".list tbody tr");
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toContainText("2026-01-02 09:00:00");
  await expect(rows.nth(0)).toContainText("failed");
  await expect(rows.nth(1)).toContainText("2026-01-01 12:00:00");
  await expect(rows.nth(1)).toContainText("passed");
  // the merged run shows what it combined
  await expect(rows.nth(2)).toContainText("platform=linux|windows");

  // the newest run is preselected; its detail shows tests, the cached
  // marker, the reason lines, the service row and the merged log
  const detail = page.locator(".detail");
  await expect(detail).toContainText("20260102-090000-fx02");
  await expect(detail).toContainText("cached");
  await expect(detail).toContainText("cache hit: inputs unchanged");
  await expect(detail).toContainText("cache miss: src/**: 1 changed file (src/math.ts)");
  await expect(detail).toContainText("service db");
  await expect(detail.locator(".log")).toContainText("boom: expected 4 to equal 5");

  await screenshots(page, "runs");
});

test("a single test log opens from the run detail", async ({ page }) => {
  await page
    .locator(".detail tr", { hasText: "unit" })
    .getByRole("button", { name: "show" })
    .first()
    .click();
  const log = page.locator(".detail .log");
  await expect(log).toContainText("41 tests passed");
  await expect(log).toContainText("boom: expected 4 to equal 5");
  await expect(log).not.toContainText("===", { timeout: 1000 });

  await screenshots(page, "test-log");
});

test("the log renders ANSI colour instead of printing it", async ({ page }) => {
  const log = page.locator(".detail .log");
  // the escape sequences are gone from the text ...
  await expect(log).toContainText("41 tests passed");
  await expect(log).not.toContainText("[32m", { timeout: 1000 });
  // ... and are colour on the page instead
  const failed = log.locator("span", { hasText: "boom: expected 4 to equal 5" }).last();
  await expect(failed).toHaveCSS("color", "rgb(255, 92, 105)");
  await expect(failed).toHaveCSS("font-weight", "600");
  const passed = log.locator("span", { hasText: "41 tests passed" }).last();
  await expect(passed).toHaveCSS("color", "rgb(61, 220, 132)");
});

test("the log can be searched, wrapped and followed", async ({ page }) => {
  const log = page.locator(".detail .log");
  await expect(page.locator(".log-lines")).toContainText("lines");

  // wrap is on to begin with and can be turned off
  const wrap = page.getByRole("button", { name: "wrap" });
  await expect(wrap).toHaveAttribute("aria-pressed", "true");
  await expect(log).toHaveCSS("white-space", "pre-wrap");
  await wrap.click();
  await expect(log).toHaveCSS("white-space", "pre");
  await wrap.click();

  // searching highlights every hit and says which one is current
  await page.getByPlaceholder("find in log").fill("failed");
  await expect(log.locator("mark")).toHaveCount(2);
  await expect(page.locator(".log-hits")).toContainText("1 of 2");
  await expect(log.locator("mark.on")).toHaveCount(1);

  await page.getByRole("button", { name: "next match" }).click();
  await expect(page.locator(".log-hits")).toContainText("2 of 2");
  // the buttons wrap around rather than stopping at the end
  await page.getByRole("button", { name: "next match" }).click();
  await expect(page.locator(".log-hits")).toContainText("1 of 2");
  await page.getByRole("button", { name: "previous match" }).click();
  await expect(page.locator(".log-hits")).toContainText("2 of 2");

  await screenshots(page, "log-search");

  await page.getByPlaceholder("find in log").fill("nothing here");
  await expect(page.locator(".log-hits")).toContainText("no match");
  await expect(log.locator("mark")).toHaveCount(0);

  // follow is off until asked for
  const follow = page.getByRole("button", { name: "follow" });
  await expect(follow).toHaveAttribute("aria-pressed", "false");
  await follow.click();
  await expect(follow).toHaveAttribute("aria-pressed", "true");
});

test("what a run kept can be opened from the page", async ({ page }) => {
  const detail = page.locator(".detail");

  // the record the page was built from, and the JUnit report next to it
  const runYaml = detail.locator(".files a", { hasText: "run.yaml" });
  await expect(runYaml).toHaveAttribute(
    "href",
    "/api/runs/20260102-090000-fx02/artifacts/run.yaml",
  );
  await expect(detail.locator(".files a", { hasText: "junit.xml" })).toHaveAttribute(
    "href",
    "/api/runs/20260102-090000-fx02/artifacts/junit.xml",
  );

  // the artifact badge is a link now, named after the file
  const report = detail.locator("table.tree a.file");
  await expect(report).toHaveCount(1);
  await expect(report).toHaveText("report.txt");
  await expect(report).toHaveAttribute("title", "artifacts/ci-unit/report.txt");

  // and each of them is really served
  for (const link of [runYaml, report]) {
    const href = (await link.getAttribute("href")) ?? "";
    const response = await page.request.get(href);
    expect(response.status(), href).toBe(200);
    expect(response.headers()["x-content-type-options"]).toBe("nosniff");
  }
  const body = await page.request.get((await report.getAttribute("href")) ?? "");
  expect(await body.text()).toContain("1 failure: math.test.ts");

  // nothing outside the run folder is reachable
  const escaped = await page.request.get(
    "/api/runs/20260102-090000-fx02/artifacts/..%2f..%2frun.yaml",
  );
  expect(escaped.status()).toBe(400);

  await screenshots(page, "artifacts");
});

test("older runs can be selected", async ({ page }) => {
  await page.locator(".list tbody tr").nth(1).click();
  const detail = page.locator(".detail");
  await expect(detail).toContainText("20260101-120000-fx01");
  // the selection is in the URL, not only in the component
  await expect(page).toHaveURL("/runs/20260101-120000-fx01");
  await expect(detail).toContainText("cache miss: no stored passing result");
  await expect(detail.locator(".log")).toContainText("build finished");
});

test("a merged run shows its legs and one row per variant", async ({ page }) => {
  await page.locator(".list tbody tr").nth(2).click();
  const detail = page.locator(".detail");
  await expect(detail).toContainText("20251231-080000-fx00");
  await expect(detail).toContainText("merged from 2 runs");
  await expect(detail).toContainText("20251231-075000-lnx1");
  await expect(detail).toContainText("ci-windows");

  // the same test once per platform, each tagged with its variant
  const unit = detail.locator("tbody tr", { hasText: "unit" });
  await expect(unit).toHaveCount(2);
  await expect(unit.nth(0)).toContainText("platform=linux");
  await expect(unit.nth(1)).toContainText("platform=windows");

  await screenshots(page, "merged-run");
});

test("tests view aggregates tests across runs", async ({ page }) => {
  await page.locator("nav button", { hasText: "Tests" }).click();

  const rows = page.locator(".list tbody tr");
  await expect(rows).toHaveCount(3); // ci, ci/build, ci/unit

  const unit = rows.filter({ hasText: "ci/unit" });
  await expect(unit.locator("td").nth(1)).toContainText("failed"); // last status
  await expect(unit.locator("td").nth(2).locator(".spark-block")).toHaveCount(4); // history
  await expect(unit.locator("td").nth(3)).toHaveText("2"); // passes
  await expect(unit.locator("td").nth(4)).toHaveText("2"); // fails
  await expect(unit.locator("td").nth(5)).toHaveText("4"); // runs (merged legs count)

  await unit.click();
  const detail = page.locator(".detail");
  await expect(detail).toContainText("executions of");
  await expect(detail).toContainText("ci/unit");
  await expect(detail.locator("tbody tr")).toHaveCount(4);

  await screenshots(page, "tests");
});

test("an execution opens its own page: that test in that run", async ({ page }) => {
  await page.locator("nav button", { hasText: "Tests" }).click();
  await page.locator(".list tbody tr").filter({ hasText: "ci/unit" }).click();
  // the newest execution in the detail table leads to the test page
  await page.locator(".detail tbody tr").first().click();
  await expect(page).toHaveURL("/runs/20260102-090000-fx02/tests/ci/unit");

  // breadcrumb back out, tabs across: overview, the log, related services
  await expect(page.locator(".breadcrumb")).toContainText("Tests");
  await expect(page.locator(".breadcrumb")).toContainText("ci/unit");
  await expect(page.locator(".breadcrumb")).toContainText("20260102-090000-fx02");
  await expect(page.locator(".tabs button.active")).toHaveText("Overview");
  await expect(page.locator("main.single .meta")).toContainText("failed");

  await page.locator(".tabs button", { hasText: "Test log" }).click();
  await expect(page.locator("main.single .log")).toContainText("boom: expected 4 to equal 5");
  await screenshots(page, "test-page");

  // the breadcrumb's run link lands on the run's own page
  await page.locator(".breadcrumb button", { hasText: "20260102-090000-fx02" }).click();
  await expect(page).toHaveURL("/runs/20260102-090000-fx02");
});

test("the tests tab used to be called results; old links keep working", async ({ page }) => {
  await page.goto("/results/ci/unit");
  await expect(page.locator("nav button", { hasText: "Tests" })).toHaveClass(/active/);
  await expect(page.locator(".detail")).toContainText("executions of");
});

test("every selection is a link that can be shared and reloaded", async ({ page }) => {
  // a run deep link opens that run, not the newest one - filters or not
  await page.goto("/runs/20260101-120000-fx01");
  await expect(page.locator(".detail")).toContainText("20260101-120000-fx01");

  // a test path keeps its slashes, so the URL reads like the test does
  await page.goto("/tests/ci/unit");
  await expect(page.locator("nav button", { hasText: "Tests" })).toHaveClass(/active/);
  const detail = page.locator(".detail");
  await expect(detail).toContainText("executions of");
  await expect(detail).toContainText("ci/unit");

  // switching tabs and picking rows writes the URL ...
  await page.locator("nav button", { hasText: "Runs" }).click();
  await expect(page).toHaveURL("/runs");
  // this navigation reloaded the app, so the frozen fixture needs "all" again
  await page.getByRole("button", { name: "all", exact: true }).click();
  await page.locator(".list tbody tr").nth(2).click();
  await expect(page).toHaveURL("/runs/20251231-080000-fx00");

  // ... and the back button walks it back
  await page.goBack();
  await expect(page).toHaveURL("/runs");
  await page.goBack();
  await expect(page).toHaveURL("/tests/ci/unit");
  await expect(page.locator(".detail")).toContainText("executions of");
});

test("an unknown run id falls back to the newest run", async ({ page }) => {
  await page.goto("/runs/does-not-exist");
  await expect(page.locator(".detail")).toContainText("20260102-090000-fx02");
});

test("the runs table opens on the last 30 days and can be widened", async ({ page }) => {
  await page.reload();
  await expect(page.locator("header .live")).toContainText("3 runs");

  // the fixture runs are older than 30 days, so the default hides them ...
  await expect(page.getByRole("button", { name: "30 days" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.locator(".filter-count")).toContainText("0 of 3 runs");
  await expect(page.locator(".list tbody")).toContainText("no run matches the filters");
  // ... but a linked run stays visible, filters or not
  await expect(page.locator(".detail")).toContainText("20260102-090000-fx02");

  await page.getByRole("button", { name: "all", exact: true }).click();
  await expect(page.locator(".filter-count")).toContainText("3 runs");
  await expect(page.locator(".list tbody tr")).toHaveCount(3);
});

test("status, variant and text filters narrow the runs", async ({ page }) => {
  // the newest run failed, and so did the merged one (its windows leg did)
  await page.getByRole("button", { name: "failed", exact: true }).click();
  await expect(page.locator(".filter-count")).toContainText("2 of 3 runs");
  await expect(page.locator(".list tbody tr")).toHaveCount(2);
  await page.getByRole("button", { name: "failed", exact: true }).click(); // toggles off
  await expect(page.locator(".filter-count")).toContainText("3 runs");

  // a variant of one merged leg selects the run that contains it
  await page.getByRole("button", { name: "platform=windows" }).click();
  await expect(page.locator(".list tbody tr")).toHaveCount(1);
  await expect(page.locator(".list tbody tr").first()).toContainText("platform=linux|windows");
  // clearing goes back to the defaults, including the 30-day window
  await page.getByRole("button", { name: "clear filters" }).click();
  await expect(page.locator(".filter-count")).toContainText("0 of 3 runs");
  await page.getByRole("button", { name: "all", exact: true }).click();

  // free text matches ids and test paths
  await page.getByPlaceholder("run id, test, variant").fill("fx01");
  await expect(page.locator(".list tbody tr")).toHaveCount(1);
  await expect(page.locator(".list tbody tr").first()).toContainText("2026-01-01 12:00:00");
});

test("runs carry their labels and can be filtered by them", async ({ page }) => {
  // the newest run came from a pull request; its labels say which
  const detail = page.locator(".detail .labels");
  await expect(detail.locator(".badge.label")).toHaveCount(5);
  await expect(detail).toContainText("trigger=pull_request");
  await expect(detail).toContainText("branch=fix/math");
  await expect(detail).toContainText("base=main");
  await expect(detail).toContainText("pr=42");
  await expect(detail).toContainText("actor=octocat");

  // every label of every run is a chip
  await page.getByRole("button", { name: "branch=main", exact: true }).click();
  await expect(page.locator(".filter-count")).toContainText("2 of 3 runs");
  await page.getByRole("button", { name: "branch=main", exact: true }).click();

  await page.getByRole("button", { name: "trigger=schedule", exact: true }).click();
  await expect(page.locator(".list tbody tr")).toHaveCount(1);
  await expect(page.locator(".list tbody tr").first()).toContainText("2025-12-31");

  await screenshots(page, "labels");

  await page.getByRole("button", { name: "clear filters" }).click();
  await page.getByRole("button", { name: "all", exact: true }).click();

  // and the text box searches them as well
  await page.getByPlaceholder("run id, test, variant, label").fill("pr=42");
  await expect(page.locator(".list tbody tr")).toHaveCount(1);
  await expect(page.locator(".list tbody tr").first()).toContainText("2026-01-02");
});

test("the tests table filters by status, tag and text", async ({ page }) => {
  await page.locator("nav button", { hasText: "Tests" }).click();
  await expect(page.locator(".filter-count")).toContainText("3 tests");

  // tags come from the recorded suite tree, not from the test results
  await page.getByRole("button", { name: "unit", exact: true }).click();
  await expect(page.locator(".list tbody tr")).toHaveCount(1);
  await expect(page.locator(".list tbody tr").first()).toContainText("ci/unit");
  await page.getByRole("button", { name: "clear filters" }).click();

  await page.getByPlaceholder("test path or tag").fill("build");
  await expect(page.locator(".list tbody tr")).toHaveCount(1);
  await expect(page.locator(".list tbody tr").first()).toContainText("ci/build");
});

test("a verdict needs enough results, so the small fixture gets none", async ({ page }) => {
  await page.locator("nav button", { hasText: "Tests" }).click();
  await expect(page.locator(".filter-count")).toContainText("3 tests");

  // ci and ci/unit each passed and failed here, but with 4 results apiece
  // the fixture is under the 10 a verdict needs, so nothing is labelled.
  // (The badges themselves are covered by the component tests.)
  await expect(page.locator(".badge.flaky")).toHaveCount(0);
  await expect(page.locator(".badge.broken")).toHaveCount(0);

  await page.getByRole("button", { name: "flaky only" }).click();
  await expect(page.locator(".filter-count")).toContainText("0 of 3 tests");
  await expect(page.locator(".list tbody")).toContainText("no test matches the filters");

  await screenshots(page, "flaky");

  await page.getByRole("button", { name: "clear filters" }).click();
  await expect(page.locator(".list tbody tr")).toHaveCount(3);
});

test("a run can be compared with the one before it", async ({ page }) => {
  const detail = page.locator(".detail");
  // nothing is compared until asked
  await expect(detail.locator(".diff")).toHaveCount(0);

  await detail.getByRole("button", { name: "previous run" }).click();
  const diff = detail.locator(".diff");
  await expect(diff).toContainText("newly failed (2)");
  await expect(diff).toContainText("ci/unit");
  // ci/build was cached this time: 2.2s down to 40ms
  await expect(diff).toContainText("duration (1)");
  await expect(diff).toContainText("2.2s → 40ms");
  await expect(diff.locator(".faster")).toBeVisible();

  await screenshots(page, "run-diff");

  // comparing a run with itself is not offered, and picking another run
  // drops the comparison
  await page.locator(".list tbody tr").nth(1).click();
  await expect(detail).toContainText("20260101-120000-fx01");
  await expect(detail.locator(".diff")).toHaveCount(0);

  // the merged run is the oldest one, so it has nothing before it
  await page.locator(".list tbody tr").nth(2).click();
  await expect(detail.getByRole("button", { name: "previous run" })).toHaveCount(0);
  await expect(detail.getByLabel("compare with")).toBeVisible();
});

test("every column sorts, both ways", async ({ page }) => {
  const started = page.locator(".list th button", { hasText: "Started" });
  const rows = page.locator(".list tbody tr");

  // the runs table opens newest first
  await expect(page.locator(".list th").first()).toHaveAttribute("aria-sort", "descending");
  await expect(rows.first()).toContainText("2026-01-02 09:00:00");
  await started.click();
  await expect(page.locator(".list th").first()).toHaveAttribute("aria-sort", "ascending");
  await expect(rows.first()).toContainText("2025-12-31 07:50:00");

  // another column takes over, and the first one goes back to unsorted
  await page.locator(".list th button", { hasText: "Duration" }).click();
  await expect(page.locator(".list th").first()).toHaveAttribute("aria-sort", "none");
  await expect(rows.first()).toContainText("3.2s");
  await expect(rows.last()).toContainText("9.5s");
  await page.locator(".list th button", { hasText: "Duration" }).click();
  await expect(rows.first()).toContainText("9.5s");

  await screenshots(page, "sorted");

  // sorting is per table: the results tab has its own
  await page.locator("nav button", { hasText: "Tests" }).click();
  await page.locator(".list th button", { hasText: "Failed" }).click();
  const tests = page.locator(".list tbody tr");
  await expect(tests.first()).toContainText("ci/build");
  await page.locator(".list th button", { hasText: "Failed" }).click();
  await expect(tests.first()).not.toContainText("ci/build");

  // and the executions table on the right sorts on its own
  await page.locator(".detail th button", { hasText: "Duration" }).click();
  const durations = page.locator(".detail tbody tr");
  await expect(durations.first()).toContainText("3.1s");
  await expect(durations.last()).toContainText("5.3s");
});

test("a run lays its tests out on a timeline", async ({ page }) => {
  const timeline = page.locator(".detail .timeline");
  const bars = timeline.locator(".timeline-bar");
  await expect(bars).toHaveCount(3);

  // the axis runs from the start of the run to its end
  await expect(timeline.locator(".timeline-tick").first()).toHaveText("0ms");
  await expect(timeline.locator(".timeline-tick").last()).toHaveText("3.2s");

  // ci covers the run; ci/build is a sliver at the front, ci/unit the rest
  await expect(bars.nth(1)).toHaveAttribute("aria-label", "ci/build at 60ms");
  await expect(bars.nth(2)).toHaveAttribute("aria-label", "ci/unit at 120ms");
  await expect(bars.nth(2)).toHaveClass(/status-failed/);

  // a bar opens that test's log, like its row in the tree does
  await bars.nth(2).click();
  await expect(page.locator(".detail .log")).toContainText("boom: expected 4 to equal 5");
  await expect(page.locator(".detail .log")).not.toContainText("===", { timeout: 1000 });

  await screenshots(page, "timeline");

  // a merged run puts every leg on one axis: windows started 5 minutes in
  await page.locator("nav button", { hasText: "Runs" }).click();
  await page.getByRole("button", { name: "all", exact: true }).click();
  await page.locator(".list tbody tr").nth(2).click();
  const merged = page.locator(".detail .timeline .timeline-bar");
  await expect(merged).toHaveCount(4);
  await expect(merged.nth(0)).toHaveAttribute("aria-label", "ci at 100ms");
  await expect(merged.nth(2)).toHaveAttribute("aria-label", "ci at 5m0s");
});

test("the run detail is the suite tree, including what never ran", async ({ page }) => {
  const detail = page.locator(".detail");

  // the recorded suite, indented, with kinds, tags and declared services
  const rows = detail.locator("table.tree tbody tr");
  await expect(rows).toHaveCount(4);
  await expect(rows.nth(0)).toContainText("ci");
  await expect(rows.nth(0)).toContainText("sequence");
  await expect(rows.nth(1)).toContainText("build");
  await expect(rows.nth(2)).toContainText("unit");
  await expect(rows.nth(2)).toContainText("fast");

  // ci/e2e is in the Testfile but was not part of this run
  const notRun = rows.nth(3);
  await expect(notRun).toContainText("e2e");
  await expect(notRun).toContainText("service db");
  await expect(notRun).toContainText("not run");
  await expect(notRun).toHaveClass(/not-run/);

  // services keep their own table below the tree
  await expect(detail.locator("table.services")).toContainText("service db");

  await screenshots(page, "suite-tree");
});

test("groups collapse and expand", async ({ page }) => {
  const rows = page.locator(".detail table.tree tbody tr");
  await expect(rows).toHaveCount(4);

  await page.getByRole("button", { name: "collapse ci" }).click();
  await expect(rows).toHaveCount(1);
  await page.getByRole("button", { name: "expand ci" }).click();
  await expect(rows).toHaveCount(4);

  await page.getByRole("button", { name: "collapse all" }).click();
  await expect(rows).toHaveCount(1);
  await page.getByRole("button", { name: "expand all" }).click();
  await expect(rows).toHaveCount(4);
});
