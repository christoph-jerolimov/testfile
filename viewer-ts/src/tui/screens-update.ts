// Regenerates the committed TUI screenshots: screens/<name>.ans (the raw
// frame, what the test compares) and screens/<name>.svg (the same frame
// drawn as an image, for humans). Run via:
//
//   npm run screens:update --workspace viewer-ts
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ansiToSvg } from "./ansi-svg.js";
import { captureScreens } from "./screens.js";

const dir = fileURLToPath(new URL("../../screens/", import.meta.url));
mkdirSync(dir, { recursive: true });
const screens = await captureScreens();
for (const screen of screens) {
  writeFileSync(`${dir}${screen.name}.ans`, screen.frame);
  writeFileSync(
    `${dir}${screen.name}.svg`,
    ansiToSvg(screen.frame, { columns: screen.columns, rows: screen.rows }),
  );
  console.log(`${screen.name} (${screen.columns}x${screen.rows})`);
}
console.log(`${screens.length} screens written to ${dir}`);
