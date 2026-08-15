// The TUI's screenshot suite: every page renders against the committed
// frames in screens/ - the terminal counterpart of the web viewer's
// Playwright screenshots. On an intended change, refresh them with
//
//   npm run screens:update --workspace @testfile/tui
//
// and commit the .ans/.svg pair like any other snapshot.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { captureScreens } from "./screens.js";

const dir = fileURLToPath(new URL("../screens/", import.meta.url));

test("every TUI page renders exactly the committed screenshot", async () => {
  const screens = await captureScreens();
  assert.ok(screens.length >= 7, "the capture list lost screens");
  for (const screen of screens) {
    let committed: string;
    try {
      committed = readFileSync(`${dir}${screen.name}.ans`, "utf8");
    } catch {
      assert.fail(
        `no committed screenshot for "${screen.name}" - run: npm run screens:update --workspace @testfile/tui`,
      );
    }
    assert.equal(
      screen.frame,
      committed,
      `the "${screen.name}" screen changed - if intended, run: npm run screens:update --workspace @testfile/tui`,
    );
  }
});
