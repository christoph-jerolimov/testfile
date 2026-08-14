import { defineConfig } from "@playwright/test";

// The wizard on /start is a generator with a form around it. These tests
// drive the built page in a browser and compare what it produces with the
// files committed under e2e/expected - written by hand, not generated - so
// the test has its own idea of what the page should say. Importing the
// generator and asserting against its own output would only prove that the
// code equals itself.
//
// There is no server: the spec serves dist/ into the browser by
// intercepting its requests, so the suite needs a build and nothing else.
const chromium = process.env.TESTFILE_E2E_CHROMIUM;

export default defineConfig({
  testDir: "e2e",
  outputDir: "test-results",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  reporter: [["list"]],
  use: {
    viewport: { width: 1280, height: 900 },
    // An escape hatch for machines that cannot download the browser
    // Playwright asks for (an offline box, a sandbox).
    ...(chromium ? { launchOptions: { executablePath: chromium } } : {}),
  },
});
