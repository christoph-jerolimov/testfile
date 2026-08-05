import { expect, test } from "@playwright/test";

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

  await expect(page).toHaveScreenshot("runs.png");
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

  await expect(page).toHaveScreenshot("test-log.png");
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

  await expect(page).toHaveScreenshot("log-search.png");

  await page.getByPlaceholder("find in log").fill("nothing here");
  await expect(page.locator(".log-hits")).toContainText("no match");
  await expect(log.locator("mark")).toHaveCount(0);

  // follow is off until asked for
  const follow = page.getByRole("button", { name: "follow" });
  await expect(follow).toHaveAttribute("aria-pressed", "false");
  await follow.click();
  await expect(follow).toHaveAttribute("aria-pressed", "true");
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

  await expect(page).toHaveScreenshot("merged-run.png");
});

test("results view aggregates tests across runs", async ({ page }) => {
  await page.getByRole("button", { name: "Results" }).click();

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

  await expect(page).toHaveScreenshot("results.png");
});

test("every selection is a link that can be shared and reloaded", async ({ page }) => {
  // a run deep link opens that run, not the newest one - filters or not
  await page.goto("/runs/20260101-120000-fx01");
  await expect(page.locator(".detail")).toContainText("20260101-120000-fx01");

  // a test path keeps its slashes, so the URL reads like the test does
  await page.goto("/results/ci/unit");
  await expect(page.getByRole("button", { name: "Results" })).toHaveClass(/active/);
  const detail = page.locator(".detail");
  await expect(detail).toContainText("executions of");
  await expect(detail).toContainText("ci/unit");

  // switching tabs and picking rows writes the URL ...
  await page.getByRole("button", { name: "Runs" }).click();
  await expect(page).toHaveURL("/runs");
  // this navigation reloaded the app, so the frozen fixture needs "all" again
  await page.getByRole("button", { name: "all", exact: true }).click();
  await page.locator(".list tbody tr").nth(2).click();
  await expect(page).toHaveURL("/runs/20251231-080000-fx00");

  // ... and the back button walks it back
  await page.goBack();
  await expect(page).toHaveURL("/runs");
  await page.goBack();
  await expect(page).toHaveURL("/results/ci/unit");
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

test("the results table filters by status, tag and text", async ({ page }) => {
  await page.getByRole("button", { name: "Results" }).click();
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

test("the results table can be narrowed to the flaky tests", async ({ page }) => {
  await page.getByRole("button", { name: "Results" }).click();
  await expect(page.locator(".filter-count")).toContainText("3 tests");

  // ci/build passed in every run, so it is not flaky; ci and ci/unit are
  await page.getByRole("button", { name: "flaky only" }).click();
  const rows = page.locator(".list tbody tr");
  await expect(rows).toHaveCount(2);
  await expect(page.locator(".filter-count")).toContainText("2 of 3 tests");
  await expect(rows.filter({ hasText: "ci/build" })).toHaveCount(0);
  await expect(rows.first().locator(".badge.flaky")).toBeVisible();

  await expect(page).toHaveScreenshot("flaky.png");

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

  await expect(page).toHaveScreenshot("run-diff.png");

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

  await expect(page).toHaveScreenshot("suite-tree.png");
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
