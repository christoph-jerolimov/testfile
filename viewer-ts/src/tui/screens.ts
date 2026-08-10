// Captures the TUI's pages as frames - the terminal equivalent of the web
// viewer's e2e screenshots. A fixed fake history renders each page at a
// fixed size, keys drive the navigation, and the raw frames (styles
// included) are what gets committed, compared and drawn as SVGs.
//
// Color is decided by the environment when ink loads, so everything that
// touches ink is imported dynamically after FORCE_COLOR is set.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RunHistory, RunRecord } from "../runrecord.js";

export const SCREEN_SIZE = { columns: 100, rows: 30 };
export const NARROW_SIZE = { columns: 72, rows: 30 };

const KEY = {
  enter: "\r",
  tab: "\t",
  down: `${String.fromCharCode(27)}[B`,
  right: `${String.fromCharCode(27)}[C`,
};

function record(overrides: Partial<RunRecord>): RunRecord {
  return {
    id: "20260105-090000-aa01",
    startedAt: "2026-01-05T09:00:00.000Z",
    durationMs: 154_000,
    status: "passed",
    exitCode: 0,
    cancelled: false,
    env: { BASE_URL: "http://127.0.0.1:4173" },
    ports: { web: 4173 },
    selected: [],
    suite: {
      name: "ci",
      path: "ci",
      kind: "sequence",
      children: [
        { name: "build", path: "ci/build", kind: "command" },
        {
          name: "checks",
          path: "ci/checks",
          kind: "parallel",
          children: [
            { name: "lint", path: "ci/checks/lint", kind: "command" },
            { name: "unit", path: "ci/checks/unit", kind: "command" },
            { name: "e2e", path: "ci/checks/e2e", kind: "command", services: ["db", "web"] },
          ],
        },
      ],
    },
    tests: [
      { path: "ci", status: "passed", startedAfterMs: 0, durationMs: 154_000 },
      { path: "ci/build", status: "passed", startedAfterMs: 200, durationMs: 21_000, cached: true },
      { path: "ci/checks", status: "passed", startedAfterMs: 21_400, durationMs: 132_000 },
      { path: "ci/checks/lint", status: "passed", startedAfterMs: 21_500, durationMs: 8_000 },
      { path: "ci/checks/unit", status: "passed", startedAfterMs: 21_500, durationMs: 64_000 },
      {
        path: "ci/checks/e2e",
        status: "passed",
        startedAfterMs: 21_600,
        durationMs: 131_000,
        log: "tests/ci-checks-e2e.log",
        artifacts: ["artifacts/ci-checks-e2e/report.html"],
      },
    ],
    services: [
      { name: "db", status: "stopped", log: "services/db.log" },
      { name: "web", status: "stopped", log: "services/web.log" },
    ],
    ...overrides,
  };
}

function fixtureHistory(): RunHistory {
  const failing = record({
    id: "20260105-113000-bb02",
    startedAt: "2026-01-05T11:30:00.000Z",
    durationMs: 98_000,
    status: "failed",
    exitCode: 1,
  });
  failing.tests = failing.tests.map((test) =>
    test.path === "ci/checks/e2e" || test.path === "ci/checks" || test.path === "ci"
      ? { ...test, status: "failed", durationMs: (test.durationMs ?? 0) / 2 }
      : test,
  );
  const runs = [
    failing,
    record({}),
    record({
      id: "20260104-090000-cc03",
      startedAt: "2026-01-04T09:00:00.000Z",
      variants: { platform: "linux" },
    }),
  ];
  return {
    runs,
    reload() {},
    readRunLog: () =>
      [
        "=== ci/build ===",
        "# cache hit: inputs unchanged",
        "=== ci/checks/e2e ===",
        "41 tests passed",
        "boom: expected 4 to equal 5",
      ].join("\n"),
    readLog: () =>
      [
        "$ npm run e2e",
        "41 tests passed",
        "boom: expected 4 to equal 5",
        "  at math.test.ts:12",
      ].join("\n"),
    readServiceLog: () => ["listening on 5432", "connection from 127.0.0.1"].join("\n"),
  } as unknown as RunHistory;
}

export interface Screen {
  name: string;
  columns: number;
  rows: number;
  frame: string;
}

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 60));

// Renders every screen the suite pins. Order matters only for reading the
// list; each screen starts from a fresh app.
export async function captureScreens(): Promise<Screen[]> {
  process.env.FORCE_COLOR = "1";
  const [{ App }, { renderForTest }, reactModule] = await Promise.all([
    import("./app.js"),
    import("./test-render.js"),
    import("react"),
  ]);
  const React = reactModule.default;

  const screens: Screen[] = [];
  const capture = async (
    name: string,
    size: { columns: number; rows: number },
    view: "runs" | "tests",
    keys: string[],
  ): Promise<void> => {
    const dir = mkdtempSync(join(tmpdir(), "tui-screens-"));
    const ui = renderForTest(
      React.createElement(App, { history: fixtureHistory(), baseDir: dir, initialView: view }),
      size,
    );
    try {
      await tick();
      for (const key of keys) {
        ui.stdin.write(key);
        await tick();
      }
      screens.push({ name, ...size, frame: ui.lastRawFrame() ?? "" });
    } finally {
      ui.unmount();
      rmSync(dir, { recursive: true, force: true });
    }
  };

  await capture("index-runs", SCREEN_SIZE, "runs", []);
  await capture("index-tests", SCREEN_SIZE, "tests", [KEY.down, KEY.down]);
  // the newest run's page: suite tree left, overview tabs right
  await capture("run", SCREEN_SIZE, "runs", [KEY.enter, KEY.down, KEY.down, KEY.down, KEY.down]);
  // one execution's page: overview, log and service tabs
  await capture("test", SCREEN_SIZE, "tests", [KEY.down, KEY.down, KEY.enter, KEY.enter]);
  await capture("test-log", SCREEN_SIZE, "tests", [
    KEY.down,
    KEY.down,
    KEY.enter,
    KEY.enter,
    KEY.tab,
  ]);
  await capture("shortcuts", SCREEN_SIZE, "runs", ["?"]);
  // below 80 columns only the left panel shows; details open as pages
  await capture("index-tests-narrow", NARROW_SIZE, "tests", [KEY.down, KEY.down]);
  return screens;
}
