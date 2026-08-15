// Regenerates the committed TUI screenshots: screens/<name>.ans (the raw
// frame, what the test compares) and, per theme, screens/<name>-<theme>.svg
// plus a rasterized screens/<name>-<theme>.png - the images are for humans.
// Run via:
//
//   npm run screens:update --workspace @testfile/tui
//
// The PNGs render through the same pinned Playwright Chromium the web
// viewer's screenshots use; TESTFILE_SCREENS_CHROMIUM points at an existing
// browser on machines that cannot download it.
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ansiToSvg, svgSize, type Theme } from "./ansi-svg.js";
import { captureScreens } from "./screens.js";

const THEMES: Theme[] = ["dark", "light"];

const dir = fileURLToPath(new URL("../screens/", import.meta.url));
mkdirSync(dir, { recursive: true });
const screens = await captureScreens();

const { chromium } = await import("@playwright/test");
const executablePath = process.env.TESTFILE_SCREENS_CHROMIUM;
const browser = await chromium.launch(executablePath ? { executablePath } : {});
const page = await browser.newPage({ deviceScaleFactor: 2 });

for (const screen of screens) {
  writeFileSync(`${dir}${screen.name}.ans`, screen.frame);
  const { width, height } = svgSize(screen.columns, screen.rows);
  for (const theme of THEMES) {
    const svgPath = `${dir}${screen.name}-${theme}.svg`;
    writeFileSync(
      svgPath,
      ansiToSvg(screen.frame, { columns: screen.columns, rows: screen.rows, theme }),
    );
    await page.setViewportSize({ width, height });
    await page.goto(pathToFileURL(svgPath).href);
    await page.screenshot({ path: `${dir}${screen.name}-${theme}.png` });
  }
  console.log(`${screen.name} (${screen.columns}x${screen.rows}, ${THEMES.join("/")}, svg+png)`);
}
await browser.close();
console.log(`${screens.length} screens written to ${dir}`);
