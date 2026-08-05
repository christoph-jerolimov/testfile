import { defineConfig } from "@playwright/test";

// Two modes:
// - standalone (`npm run test:e2e`): playwright starts `testfile-viewer
//   serve` itself over the committed fixture in e2e/fixture (viewer-ts must
//   be built: `npm run build --workspace viewer-ts`).
// - against an already-running server: set TESTFILE_E2E_URL - this is how
//   the root Testfile runs the suite, with serve started as a service.
//
// Screenshots are committed (e2e/__screenshots__); update them with
// `npm run test:e2e:update`. The @playwright/test version is pinned so the
// browser build - and therefore the rendering - is identical everywhere;
// e2e/screenshot.css forces one font stack on top.
const externalUrl = process.env.TESTFILE_E2E_URL;
const port = 7365;
// An escape hatch for machines that cannot download the browser Playwright
// asks for (an offline box, a sandbox): point this at an existing Chromium.
const chromium = process.env.TESTFILE_E2E_CHROMIUM;

export default defineConfig({
  testDir: "e2e",
  outputDir: "test-results",
  snapshotPathTemplate: "{testDir}/__screenshots__/{arg}{ext}",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  reporter: [["list"]],
  use: {
    baseURL: externalUrl ?? `http://127.0.0.1:${port}`,
    viewport: { width: 1200, height: 800 },
    deviceScaleFactor: 1,
    ...(chromium ? { launchOptions: { executablePath: chromium } } : {}),
  },
  expect: {
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.02,
      stylePath: "e2e/screenshot.css",
    },
  },
  webServer: externalUrl
    ? undefined
    : {
        command: `node ../viewer-ts/dist/cli.js serve e2e/fixture --port ${port} --name "E2E Fixture"`,
        url: `http://127.0.0.1:${port}/api/summary`,
        reuseExistingServer: false,
        timeout: 30_000,
      },
});
