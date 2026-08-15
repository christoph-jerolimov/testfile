// Layout building blocks shared by every page: the page frame with its
// breadcrumb and status line, the side-by-side split that collapses on
// narrow terminals, and the tab strip used by the detail panes.
import React, { createContext, useContext } from "react";
import { Box, Text, useStdout } from "ink";
import { NARROW_COLUMNS } from "./theme.js";
import { StatusBar } from "./statusbar.js";

// The breadcrumb root every page starts from - "Testfile", or the name the
// CLI was given with --name.
const TitleContext = createContext("Testfile");

export function TitleProvider({
  title,
  children,
}: {
  title?: string;
  children: React.ReactNode;
}): React.ReactElement {
  return <TitleContext.Provider value={title ?? "Testfile"}>{children}</TitleContext.Provider>;
}

// The terminal's size, re-read on every render; Ink re-renders on resize.
export function useScreen(): { columns: number; rows: number; narrow: boolean } {
  const { stdout } = useStdout();
  const columns = stdout?.columns ?? 100;
  const rows = stdout?.rows ?? 30;
  return { columns, rows, narrow: columns < NARROW_COLUMNS };
}

export function Breadcrumb({ segments }: { segments: string[] }): React.ReactElement {
  return (
    <Box>
      {segments.map((segment, index) => (
        <Text key={index} bold={index === segments.length - 1}>
          {index > 0 ? <Text dimColor> › </Text> : null}
          {segment}
        </Text>
      ))}
    </Box>
  );
}

// The frame every page renders in: breadcrumb on top, status line at the
// bottom, the body filling everything between. The fixed height is what
// makes the alternate-screen click mapping and the table windows exact.
export function PageShell({
  breadcrumb,
  children,
  message,
}: {
  breadcrumb: string[];
  children: React.ReactNode;
  message?: string;
}): React.ReactElement {
  const { rows } = useScreen();
  const title = useContext(TitleContext);
  return (
    <Box flexDirection="column" height={rows}>
      <Breadcrumb segments={[title, ...breadcrumb]} />
      <Box flexDirection="column" flexGrow={1}>
        {children}
      </Box>
      <StatusBar message={message} />
    </Box>
  );
}

// Two panels side by side - or, below 80 columns, only the primary one;
// the caller opens the secondary content as its own page instead.
export function SplitPanel({
  left,
  right,
  leftWidth,
}: {
  left: React.ReactNode;
  right: React.ReactNode;
  leftWidth: number;
}): React.ReactElement {
  const { narrow } = useScreen();
  if (narrow) return <Box flexDirection="column">{left}</Box>;
  return (
    <Box>
      <Box flexDirection="column" width={leftWidth} marginRight={1}>
        {left}
      </Box>
      <Box flexDirection="column" flexGrow={1}>
        {right}
      </Box>
    </Box>
  );
}

export interface TabSpec {
  id: string;
  label: string;
}

// The tab strip; the active tab's content is the caller's business, so the
// strip stays reusable between the index page and the detail panes.
export function TabStrip({
  tabs,
  active,
  focused = true,
}: {
  tabs: TabSpec[];
  active: string;
  focused?: boolean;
}): React.ReactElement {
  return (
    <Box marginBottom={0}>
      {tabs.map((tab, index) => {
        const isActive = tab.id === active;
        return (
          <Text key={tab.id}>
            {index > 0 ? "  " : ""}
            <Text inverse={isActive && focused} bold={isActive} dimColor={!isActive}>
              {" "}
              {tab.label}{" "}
            </Text>
          </Text>
        );
      })}
    </Box>
  );
}
