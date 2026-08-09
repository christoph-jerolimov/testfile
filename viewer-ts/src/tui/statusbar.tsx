// The status line and the "?" overlay share one source of truth: whatever
// component currently owns the keyboard registers its shortcuts here. The
// bar shows the active scope's shortcuts; the overlay lists every scope, so
// "?" answers "what can I press" everywhere.
import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { Box, Text } from "ink";

export interface Shortcut {
  keys: string;
  label: string;
}

interface Scope {
  id: string;
  title: string;
  shortcuts: Shortcut[];
  active: boolean;
}

interface StatusBarState {
  scopes: Map<string, Scope>;
  version: number;
}

interface StatusBarApi {
  register(scope: Scope): void;
  unregister(id: string): void;
  state: StatusBarState;
}

const StatusBarContext = createContext<StatusBarApi | undefined>(undefined);

export function StatusBarProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const [state, setState] = useState<StatusBarState>({ scopes: new Map(), version: 0 });
  const api = useMemo<StatusBarApi>(
    () => ({
      register(scope) {
        setState((prev) => {
          const scopes = new Map(prev.scopes);
          scopes.set(scope.id, scope);
          return { scopes, version: prev.version + 1 };
        });
      },
      unregister(id) {
        setState((prev) => {
          if (!prev.scopes.has(id)) return prev;
          const scopes = new Map(prev.scopes);
          scopes.delete(id);
          return { scopes, version: prev.version + 1 };
        });
      },
      state,
    }),
    [state],
  );
  return <StatusBarContext.Provider value={api}>{children}</StatusBarContext.Provider>;
}

// Registers a shortcut scope for as long as the component is mounted.
// `active` marks the scope whose shortcuts the status line shows - the
// currently focused table or pane.
export function useShortcuts(
  id: string,
  title: string,
  shortcuts: Shortcut[],
  active: boolean,
): void {
  const api = useContext(StatusBarContext);
  const serialized = JSON.stringify(shortcuts);
  useEffect(() => {
    if (!api) return;
    api.register({ id, title, shortcuts: JSON.parse(serialized) as Shortcut[], active });
    return () => api.unregister(id);
    // api identity changes with every registration; depending on it would loop
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, title, serialized, active]);
}

function useScopes(): Scope[] {
  const api = useContext(StatusBarContext);
  return api ? [...api.state.scopes.values()] : [];
}

// Shortcuts every page answers to, appended after the active scope's own.
export const GLOBAL_SHORTCUTS: Shortcut[] = [
  { keys: "?", label: "help" },
  { keys: "q", label: "quit" },
];

export function StatusBar({ message }: { message?: string }): React.ReactElement {
  const scopes = useScopes();
  const active = scopes.filter((scope) => scope.active);
  const shown = [...active.flatMap((scope) => scope.shortcuts), ...GLOBAL_SHORTCUTS];
  return (
    <Box>
      {message !== undefined && message !== "" ? (
        <Text color="yellow" wrap="truncate">
          {" "}
          {message}
        </Text>
      ) : (
        // one truncating line, so an overflowing bar clips at the right edge
        // instead of squeezing every label
        <Text wrap="truncate">
          {shown.map((shortcut, index) => (
            <Text key={`${shortcut.keys}-${index}`}>
              {index > 0 ? <Text dimColor> ·</Text> : null}{" "}
              <Text color="cyan">{shortcut.keys}</Text>
              <Text dimColor> {shortcut.label}</Text>
            </Text>
          ))}
        </Text>
      )}
    </Box>
  );
}

// The "?" overlay: every registered scope with its shortcuts, active scopes
// first. Rendered instead of the page content - terminals have no z-axis
// worth fighting over.
export function ShortcutOverlay(): React.ReactElement {
  const scopes = useScopes();
  const ordered = [...scopes].sort((a, b) => Number(b.active) - Number(a.active));
  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold>Keyboard shortcuts</Text>
      <Text> </Text>
      {ordered.map((scope) => (
        <Box key={scope.id} flexDirection="column" marginBottom={1}>
          <Text bold color={scope.active ? "cyan" : undefined}>
            {scope.title}
            {scope.active ? " (focused)" : ""}
          </Text>
          {scope.shortcuts.map((shortcut, index) => (
            <Text key={index}>
              {"  "}
              <Text color="cyan">{shortcut.keys.padEnd(12)}</Text>
              {shortcut.label}
            </Text>
          ))}
        </Box>
      ))}
      <Box flexDirection="column">
        <Text bold>Everywhere</Text>
        {GLOBAL_SHORTCUTS.map((shortcut, index) => (
          <Text key={index}>
            {"  "}
            <Text color="cyan">{shortcut.keys.padEnd(12)}</Text>
            {shortcut.label}
          </Text>
        ))}
        <Text>
          {"  "}
          <Text color="cyan">{"esc".padEnd(12)}</Text>
          back
        </Text>
      </Box>
    </Box>
  );
}
