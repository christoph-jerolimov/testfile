// The tabbed detail view over one test in one run: Overview, the test's
// log, and one tab per related service log. The run page embeds it as its
// right panel, the test page and the narrow-mode pages are it.
import React, { useMemo } from "react";
import { Box, useInput } from "ink";
import { relatedServices, type RunHistory, type RunRecord } from "@testfile.dev/core";
import { LogPane } from "./logpane.js";
import { describeRun, logToLines, testOverview, type OutputLine } from "./model.js";
import { isMouseSequence } from "./mouse.js";
import { TabStrip, type TabSpec } from "./panels.js";
import { useShortcuts } from "./statusbar.js";
import { useViewState } from "./view-state.js";

// The overview ends with a peek at the log, so the common question - what
// happened - is answered without switching tabs.
const OVERVIEW_TAIL = 20;

function logTail(text: string | undefined): OutputLine[] {
  if (text === undefined || text.trim() === "") return [];
  const lines = logToLines(text, "");
  const tail = lines.slice(-OVERVIEW_TAIL);
  return [
    { text: "", stream: "system" },
    {
      text:
        lines.length > tail.length ? `log (last ${tail.length} of ${lines.length} lines):` : "log:",
      stream: "system",
    },
    ...tail,
  ];
}

export function DetailTabs({
  id,
  history,
  run,
  path,
  height,
  width,
  focused,
}: {
  id: string;
  history: RunHistory;
  run: RunRecord;
  // Undefined shows the run itself (the tree's root selected).
  path?: string;
  height: number;
  width: number;
  focused: boolean;
}): React.ReactElement {
  const services = relatedServices(run, path);
  const tabs: TabSpec[] = [
    { id: "overview", label: "Overview" },
    { id: "log", label: "Log" },
    ...services.map((service) => ({ id: `service:${service.name}`, label: `⚙ ${service.name}` })),
  ];
  const [active, setActive] = useViewState(`${id}:tab`, "overview");
  const activeTab = tabs.some((tab) => tab.id === active) ? active : "overview";

  useInput(
    (input, key) => {
      if (isMouseSequence(input)) return;
      if (key.tab) {
        const at = tabs.findIndex((tab) => tab.id === activeTab);
        const next = tabs[(at + (key.shift ? tabs.length - 1 : 1)) % tabs.length]!;
        setActive(next.id);
      }
    },
    { isActive: focused },
  );
  useShortcuts(`${id}-tabs`, "Detail tabs", [{ keys: "tab", label: "next tab" }], focused);

  const test = path ? run.tests.find((t) => t.path === path) : undefined;
  const lines = useMemo(() => {
    if (activeTab === "overview") {
      const overview = path === undefined ? describeRun(run) : testOverview(run, path);
      const text =
        path === undefined
          ? history.readRunLog(run)
          : test
            ? history.readLog(run, test)
            : undefined;
      return [...overview, ...logTail(text)];
    }
    if (activeTab === "log") {
      if (path === undefined) return logToLines(history.readRunLog(run), "no output recorded");
      if (!test) return logToLines(undefined, "not executed in this run");
      return logToLines(history.readLog(run, test), "no output recorded");
    }
    const service = services.find((s) => `service:${s.name}` === activeTab);
    if (!service) return logToLines(undefined, "no such service");
    return logToLines(history.readServiceLog(run, service), "no output recorded");
  }, [activeTab, run, path, test, history, services]);

  return (
    <Box flexDirection="column" width={width}>
      <TabStrip tabs={tabs} active={activeTab} focused={focused} />
      <LogPane
        id={`${id}-pane-${activeTab}`}
        lines={lines}
        height={height - 1}
        width={width}
        focused={focused}
      />
    </Box>
  );
}
