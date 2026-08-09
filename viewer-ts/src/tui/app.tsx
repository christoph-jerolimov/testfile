// The read-only viewer TUI, as a multi-page interface: an index page with
// Runs and Tests tabs, a run detail page, and a per-test page - watching
// .testfile/runs/ so runs recorded by any process appear live. It never
// starts tests; that is the runner's job (`testfile start`).
import React, { useEffect, useState } from "react";
import { useApp, useInput } from "ink";
import type { RunHistory } from "../runrecord.js";
import { useInteraction, InteractionProvider } from "./interaction.js";
import { isMouseSequence } from "./mouse.js";
import { NavigationProvider, useNavigation } from "./navigation.js";
import { PageShell, TitleProvider } from "./panels.js";
import { IndexPage } from "./pages/index-page.js";
import { RunNodePage, RunPage } from "./pages/run-page.js";
import { TestPage, TestRunsPage } from "./pages/test-page.js";
import { ShortcutOverlay, StatusBarProvider } from "./statusbar.js";
import { ClickProvider } from "./table.js";
import { watchRuns } from "./watch-runs.js";

export type ViewerView = "runs" | "tests";

function Pages({
  history,
  initialView,
}: {
  history: RunHistory;
  initialView: ViewerView;
}): React.ReactElement {
  const { exit } = useApp();
  const navigation = useNavigation();
  const interaction = useInteraction();
  const [overlay, setOverlay] = useState(false);

  useInput((input, key) => {
    if (isMouseSequence(input)) return;
    if (key.ctrl && input === "c") return void exit();
    if (overlay) {
      // any key closes the overlay
      setOverlay(false);
      return;
    }
    if (key.escape) {
      if (!interaction.handleEscape()) navigation.pop();
      return;
    }
    if (interaction.textInputActive()) return;
    if (input === "q") exit();
    else if (input === "?") setOverlay(true);
  });

  if (overlay) {
    return (
      <PageShell breadcrumb={["Shortcuts"]} message="press any key to close">
        <ShortcutOverlay />
      </PageShell>
    );
  }

  const page = navigation.page;
  switch (page.kind) {
    case "run":
      return <RunPage history={history} runId={page.runId} />;
    case "run-node":
      return <RunNodePage history={history} runId={page.runId} path={page.path} />;
    case "test":
      return <TestPage history={history} runId={page.runId} path={page.path} />;
    case "test-runs":
      return <TestRunsPage history={history} path={page.path} />;
    default:
      return <IndexPage history={history} initialTab={initialView} />;
  }
}

export function App({
  history,
  baseDir,
  name,
  initialView = "runs",
}: {
  history: RunHistory;
  baseDir: string;
  name?: string;
  initialView?: ViewerView;
}): React.ReactElement {
  const [, setTick] = useState(0);

  // Watch the runs folder: runs recorded by any process appear live.
  useEffect(
    () =>
      watchRuns(baseDir, () => {
        history.reload();
        setTick((t) => t + 1);
      }),
    [history, baseDir],
  );

  return (
    <TitleProvider title={name}>
      <StatusBarProvider>
        <InteractionProvider>
          <NavigationProvider>
            <ClickProvider>
              <Pages history={history} initialView={initialView} />
            </ClickProvider>
          </NavigationProvider>
        </InteractionProvider>
      </StatusBarProvider>
    </TitleProvider>
  );
}
