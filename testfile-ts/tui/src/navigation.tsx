// Multi-page navigation: a stack of pages, escape pops. Pages are plain
// descriptors so the narrow layout can push what a wide terminal shows in
// a side panel.
import React, { createContext, useContext, useMemo, useState } from "react";

export type Page =
  | { kind: "index" }
  | { kind: "run"; runId: string }
  // One test in one run - the dedicated test page.
  | { kind: "test"; runId: string; path: string }
  // Narrow-terminal stand-ins for the right-hand panels.
  | { kind: "test-runs"; path?: string }
  | { kind: "run-node"; runId: string; path?: string };

interface Navigation {
  stack: Page[];
  page: Page;
  push(page: Page): void;
  pop(): boolean;
}

const NavigationContext = createContext<Navigation | undefined>(undefined);

export function NavigationProvider({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  const [stack, setStack] = useState<Page[]>([{ kind: "index" }]);
  const api = useMemo<Navigation>(
    () => ({
      stack,
      page: stack[stack.length - 1]!,
      push: (page) => setStack((prev) => [...prev, page]),
      pop: () => {
        if (stack.length <= 1) return false;
        setStack((prev) => prev.slice(0, -1));
        return true;
      },
    }),
    [stack],
  );
  return <NavigationContext.Provider value={api}>{children}</NavigationContext.Provider>;
}

export function useNavigation(): Navigation {
  const navigation = useContext(NavigationContext);
  if (!navigation) throw new Error("useNavigation outside NavigationProvider");
  return navigation;
}
