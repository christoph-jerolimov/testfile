import { expect, test } from "@playwright/test";

// Runs against the committed fixture in e2e/fixture (two recorded runs of
// an "e2e-fixture" suite: an older passing one and a newer failing one).
// Functional assertions first, then a screenshot per view - compare with
// `npm run test:e2e`, refresh with `npm run test:e2e:update`.

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  // wait for data AND the SSE connection, so every screenshot shows the
  // same "● live" header state
  await expect(page.locator("header .live")).toContainText("2 runs");
  await expect(page.locator("header .live")).toContainText("live");
});

test("runs view lists the history and opens the newest run", async ({ page }) => {
  await expect(page.locator("header h1")).toContainText("E2E Fixture");

  const rows = page.locator(".list tbody tr");
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText("2026-01-02 09:00:00");
  await expect(rows.nth(0)).toContainText("failed");
  await expect(rows.nth(1)).toContainText("2026-01-01 12:00:00");
  await expect(rows.nth(1)).toContainText("passed");

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
    .locator(".detail tr", { hasText: "ci/unit" })
    .getByRole("button", { name: "show" })
    .click();
  const log = page.locator(".detail .log");
  await expect(log).toContainText("41 tests passed");
  await expect(log).toContainText("boom: expected 4 to equal 5");
  await expect(log).not.toContainText("===", { timeout: 1000 });

  await expect(page).toHaveScreenshot("test-log.png");
});

test("older runs can be selected", async ({ page }) => {
  await page.locator(".list tbody tr").nth(1).click();
  const detail = page.locator(".detail");
  await expect(detail).toContainText("20260101-120000-fx01");
  await expect(detail).toContainText("cache miss: no stored passing result");
  await expect(detail.locator(".log")).toContainText("build finished");
});

test("results view aggregates tests across runs", async ({ page }) => {
  await page.getByRole("button", { name: "Results" }).click();

  const rows = page.locator(".list tbody tr");
  await expect(rows).toHaveCount(3); // ci, ci/build, ci/unit

  const unit = rows.filter({ hasText: "ci/unit" });
  await expect(unit.locator("td").nth(1)).toContainText("failed"); // last status
  await expect(unit.locator("td").nth(2)).toHaveText("1"); // passes
  await expect(unit.locator("td").nth(3)).toHaveText("1"); // fails
  await expect(unit.locator("td").nth(4)).toHaveText("2"); // runs

  await unit.click();
  const detail = page.locator(".detail");
  await expect(detail).toContainText("executions of");
  await expect(detail).toContainText("ci/unit");
  await expect(detail.locator("tbody tr")).toHaveCount(2);

  await expect(page).toHaveScreenshot("results.png");
});
