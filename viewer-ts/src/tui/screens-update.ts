// Regenerates the committed TUI screenshots: screens/<name>.ans (the raw
// frame, what the test compares) and screens/<name>-{dark,light}.svg (the
// same frame drawn as an image in both themes, for humans). Run via:
//
//   npm run screens:update --workspace viewer-ts
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ansiToSvg, type Theme } from "./ansi-svg.js";
import { captureScreens } from "./screens.js";

const THEMES: Theme[] = ["dark", "light"];

const dir = fileURLToPath(new URL("../../screens/", import.meta.url));
mkdirSync(dir, { recursive: true });
const screens = await captureScreens();
for (const screen of screens) {
  writeFileSync(`${dir}${screen.name}.ans`, screen.frame);
  for (const theme of THEMES) {
    writeFileSync(
      `${dir}${screen.name}-${theme}.svg`,
      ansiToSvg(screen.frame, { columns: screen.columns, rows: screen.rows, theme }),
    );
  }
  console.log(`${screen.name} (${screen.columns}x${screen.rows}, ${THEMES.join("/")})`);
}
console.log(`${screens.length} screens written to ${dir}`);
