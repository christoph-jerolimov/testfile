// Where the UI remembers itself across navigation. Pages unmount when
// another page is pushed; walking back must land where the user left -
// the same cursor, the same scroll, the same tab. Components keep their
// state here, keyed by a stable name, and re-seed from it on mount.
import React, { createContext, useContext, useRef, useState } from "react";

type Store = Map<string, unknown>;

const ViewStateContext = createContext<Store | null>(null);

export function ViewStateProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const store = useRef<Store>(new Map());
  return <ViewStateContext.Provider value={store.current}>{children}</ViewStateContext.Provider>;
}

// useState that survives unmounting: reads the stored value on mount and
// writes every update back. Works without a provider (plain state) so
// components stay testable in isolation.
export function useViewState<T>(key: string, initial: T): [T, (value: T) => void] {
  const store = useContext(ViewStateContext);
  const [value, setValue] = useState<T>(() =>
    store !== null && store.has(key) ? (store.get(key) as T) : initial,
  );
  const set = (next: T): void => {
    store?.set(key, next);
    setValue(next);
  };
  return [value, set];
}
