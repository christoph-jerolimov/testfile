// Keyboard arbitration. Ink hands every keypress to every active useInput,
// so keys with more than one meaning need one owner:
//
// - Escape walks a stack: the most recently claimed handler (a search box,
//   a focused right panel) gets it; with no claims the app pops the page.
// - While a text input is open, global single-letter keys ("q", "?") must
//   not fire; the input flag suppresses them.
import React, { createContext, useContext, useEffect, useMemo, useRef } from "react";

interface Interaction {
  claimEscape(id: string, handler: () => void): () => void;
  handleEscape(): boolean;
  setTextInput(id: string, active: boolean): void;
  textInputActive(): boolean;
}

const InteractionContext = createContext<Interaction | undefined>(undefined);

export function InteractionProvider({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  const escapes = useRef<{ id: string; handler: () => void }[]>([]);
  const inputs = useRef(new Set<string>());
  const api = useMemo<Interaction>(
    () => ({
      claimEscape(id, handler) {
        escapes.current = [...escapes.current.filter((e) => e.id !== id), { id, handler }];
        return () => {
          escapes.current = escapes.current.filter((e) => e.id !== id);
        };
      },
      handleEscape() {
        const top = escapes.current[escapes.current.length - 1];
        if (!top) return false;
        top.handler();
        return true;
      },
      setTextInput(id, active) {
        if (active) inputs.current.add(id);
        else inputs.current.delete(id);
      },
      textInputActive() {
        return inputs.current.size > 0;
      },
    }),
    [],
  );
  return <InteractionContext.Provider value={api}>{children}</InteractionContext.Provider>;
}

export function useInteraction(): Interaction {
  const interaction = useContext(InteractionContext);
  if (!interaction) throw new Error("useInteraction outside InteractionProvider");
  return interaction;
}

// Claims escape while `active`; the handler runs instead of the page pop.
export function useEscape(id: string, active: boolean, handler: () => void): void {
  const interaction = useInteraction();
  const latest = useRef(handler);
  latest.current = handler;
  useEffect(() => {
    if (!active) return;
    return interaction.claimEscape(id, () => latest.current());
  }, [interaction, id, active]);
}

// Marks a text input as open while `active`.
export function useTextInput(id: string, active: boolean): void {
  const interaction = useInteraction();
  useEffect(() => {
    interaction.setTextInput(id, active);
    return () => interaction.setTextInput(id, false);
  }, [interaction, id, active]);
}
