// One table to rule every list in the TUI. Headless sorting comes from
// TanStack Table (the same library the web viewer uses); this file owns the
// terminal concerns: fixed-width layout, a scrolling cursor, focus, key
// bindings, and mapping mouse clicks back to rows.
import React, { createContext, useContext, useEffect, useMemo, useRef } from "react";
import { Box, Text, useInput, type DOMElement } from "ink";
import {
  createCoreRowModel,
  createSortedRowModel,
  sortFn_alphanumeric,
  sortFn_basic,
  rowSortingFeature,
  tableFeatures,
  useTable,
  type ColumnDef,
  type Row,
  type RowData,
  type SortingState,
} from "@tanstack/react-table";
import { isMouseSequence, parseClickEvents, parseWheelEvents } from "./mouse.js";
import { useShortcuts, type Shortcut } from "./statusbar.js";
import { useViewState } from "./view-state.js";

// --- clicks ---------------------------------------------------------------

// The TUI runs on the alternate screen, so terminal cell (1,1) is the top
// left of the Ink layout and a node's absolute position is the sum of the
// yoga offsets up the tree. That makes a click resolvable to a row without
// any protocol between components: whoever can handle the coordinates does.
type ClickResolver = (x: number, y: number) => boolean;

const ClickContext = createContext<{
  register(id: string, resolver: ClickResolver): () => void;
  dispatch(x: number, y: number): void;
} | null>(null);

export function ClickProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const resolvers = useRef(new Map<string, ClickResolver>());
  const api = useMemo(
    () => ({
      register(id: string, resolver: ClickResolver) {
        resolvers.current.set(id, resolver);
        return () => {
          resolvers.current.delete(id);
        };
      },
      dispatch(x: number, y: number) {
        for (const resolver of resolvers.current.values()) {
          if (resolver(x, y)) return;
        }
      },
    }),
    [],
  );
  // One global listener turns stdin clicks into dispatches; the individual
  // tables never read the mouse themselves.
  useInput((input) => {
    if (!isMouseSequence(input)) return;
    for (const click of parseClickEvents(input)) api.dispatch(click.x, click.y);
  });
  return <ClickContext.Provider value={api}>{children}</ClickContext.Provider>;
}

// 0-based row/column of an Ink node on the alternate screen.
export function absoluteTop(node: DOMElement | undefined | null): number {
  let top = 0;
  let current: (DOMElement & { parentNode?: DOMElement }) | undefined | null = node;
  while (current) {
    const yoga = (current as { yogaNode?: { getComputedTop(): number } }).yogaNode;
    top += yoga?.getComputedTop() ?? 0;
    current = current.parentNode;
  }
  return top;
}

// --- the table ------------------------------------------------------------

// Sorting is the only TanStack feature the TUI needs; keeping the feature
// set explicit keeps the rest of the library out of the bundle - the same
// pattern the web viewer's DataTable uses.
const features = tableFeatures({
  rowSortingFeature,
  coreRowModel: createCoreRowModel(),
  sortedRowModel: createSortedRowModel(),
  sortFns: {
    alphanumeric: sortFn_alphanumeric,
    basic: sortFn_basic,
  },
});
type Features = typeof features;

export interface ColumnSpec<T extends RowData> {
  id: string;
  header: string;
  // Fixed width in cells; columns without one share the remaining space.
  width?: number;
  align?: "left" | "right";
  // The cell's value - what is shown, compared for sorting, or both.
  value(row: T): string | number | undefined;
  // Optional display override; `value` still drives sorting.
  text?(row: T): string;
  color?(row: T): string | undefined;
  dim?(row: T): boolean;
}

export interface DataTableProps<T extends RowData> {
  id: string;
  title: string;
  // Cursor and scroll survive navigation under this key (defaults to the
  // id); pages whose data changes per visit key it by what they show.
  stateKey?: string;
  data: readonly T[];
  columns: ColumnSpec<T>[];
  // Body height in rows (the header adds one line on top).
  height: number;
  width: number;
  focused: boolean;
  // Fires whenever the cursor lands on a row - sorted order, so the row
  // object is the truth, not its index.
  onCursor?(row: T | undefined): void;
  // Enter or click semantics are the page's business.
  onActivate?(row: T): void;
  // A click always moves the cursor; pages that treat a click like Enter
  // pass activateOnClick.
  activateOnClick?: boolean;
  // Extra shortcuts the owning page wants listed for this table.
  extraShortcuts?: Shortcut[];
  emptyText?: string;
}

const SORT_SHORTCUTS: Shortcut[] = [
  { keys: "↑↓ pgup/pgdn", label: "navigate" },
  { keys: "s", label: "sort column" },
  { keys: "r", label: "reverse" },
];

export function DataTable<T extends RowData>({
  id,
  title,
  stateKey,
  data,
  columns,
  height,
  width,
  focused,
  onCursor,
  onActivate,
  activateOnClick = false,
  extraShortcuts = [],
  emptyText = "nothing recorded",
}: DataTableProps<T>): React.ReactElement {
  const key = stateKey ?? id;
  const [sorting, setSorting] = useViewState<SortingState>(`${key}:sorting`, []);
  const [cursor, setCursor] = useViewState(`${key}:cursor`, 0);
  const [scroll, setScroll] = useViewState(`${key}:scroll`, 0);
  const bodyRef = useRef<DOMElement>(null);
  const clicks = useContext(ClickContext);

  const columnDefs = useMemo(
    () =>
      columns.map(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (column): ColumnDef<Features, T, any> => ({
          id: column.id,
          header: column.header,
          accessorFn: (row: T) => column.value(row) ?? "",
          // numbers compare numerically, everything else alphanumerically
          sortFn: (rowA: Row<Features, T>, rowB: Row<Features, T>, columnId: string) => {
            const a = rowA.getValue(columnId);
            const b = rowB.getValue(columnId);
            return typeof a === "number" && typeof b === "number"
              ? sortFn_basic(rowA, rowB, columnId)
              : sortFn_alphanumeric(rowA, rowB, columnId);
          },
        }),
      ),
    [columns],
  );

  const table = useTable({
    features,
    data: data as T[],
    columns: columnDefs,
    state: { sorting },
    onSortingChange: (updater) =>
      setSorting(typeof updater === "function" ? updater(sorting) : updater),
  });
  const rows = table.getRowModel().rows;

  // The cursor follows the data: clamp on shrink, keep the window around it.
  const index = Math.min(cursor, Math.max(0, rows.length - 1));
  const top = Math.min(
    Math.max(0, index - height + 1),
    Math.min(scroll, Math.max(0, rows.length - height)),
  );
  const from = index < top ? index : Math.max(top, index - height + 1);
  useEffect(() => {
    if (from !== scroll) setScroll(from);
  }, [from, scroll]);

  const cursorRow = rows[index]?.original;
  const cursorKey = rows[index]?.id;
  useEffect(() => {
    onCursor?.(cursorRow);
    // fire on the row identity, not the callback identity
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cursorKey, cursorRow === undefined]);

  const move = (delta: number): void => {
    if (rows.length === 0) return;
    setCursor(Math.max(0, Math.min(rows.length - 1, index + delta)));
  };

  useInput(
    (input, key) => {
      if (isMouseSequence(input)) {
        for (const wheel of parseWheelEvents(input)) move(wheel.direction === "up" ? -1 : 1);
        return;
      }
      if (key.upArrow) move(-1);
      else if (key.downArrow) move(1);
      else if (key.pageUp) move(-height);
      else if (key.pageDown) move(height);
      else if (input === "g") setCursor(0);
      else if (input === "G") setCursor(Math.max(0, rows.length - 1));
      else if (key.return && cursorRow !== undefined) onActivate?.(cursorRow);
      else if (input === "s") {
        // cycle: unsorted -> column 1 asc -> column 2 asc -> ... -> unsorted
        const current = sorting[0]?.id;
        const at = columns.findIndex((column) => column.id === current);
        const next = columns[at + 1];
        setSorting(next ? [{ id: next.id, desc: false }] : []);
        if (current === undefined && columns[0]) setSorting([{ id: columns[0].id, desc: false }]);
      } else if (input === "r" && sorting[0]) {
        setSorting([{ id: sorting[0].id, desc: !sorting[0].desc }]);
      }
    },
    { isActive: focused },
  );

  // Clicks: the body's absolute position turns a terminal row into a data
  // row. Registered even when unfocused - clicking is how focus moves.
  useEffect(() => {
    if (!clicks) return;
    return clicks.register(id, (x, y) => {
      const node = bodyRef.current;
      if (!node) return false;
      const yoga = (
        node as { yogaNode?: { getComputedWidth(): number; getComputedHeight(): number } }
      ).yogaNode;
      if (!yoga) return false;
      const topEdge = absoluteTop(node);
      const rowAt = y - 1 - topEdge + from;
      if (y - 1 < topEdge || y - 1 >= topEdge + Math.min(height, rows.length - from)) return false;
      if (rowAt < 0 || rowAt >= rows.length) return false;
      setCursor(rowAt);
      const row = rows[rowAt]?.original;
      if (activateOnClick && row !== undefined) onActivate?.(row);
      return true;
    });
  }, [clicks, id, from, height, rows, activateOnClick, onActivate]);

  useShortcuts(id, title, [...SORT_SHORTCUTS, ...extraShortcuts], focused);

  // --- layout -------------------------------------------------------------
  // Fixed columns keep their width; the flexible ones share what remains,
  // remainder included, so the table always fills the panel exactly. When
  // even the minimum does not fit, the row truncates at the right edge.
  const gap = 2;
  const fixed = columns.reduce((sum, c) => sum + (c.width ?? 0), 0);
  const flexCount = columns.filter((c) => c.width === undefined).length;
  const available = width - fixed - gap * (columns.length - 1);
  const flexBase = flexCount > 0 ? Math.max(4, Math.floor(available / flexCount)) : 0;
  let flexRemainder = Math.max(0, available - flexBase * flexCount);
  const columnWidths = columns.map((column) => {
    if (column.width !== undefined) return column.width;
    const extra = flexRemainder > 0 ? 1 : 0;
    flexRemainder -= extra;
    return flexBase + extra;
  });
  const widthOf = (column: ColumnSpec<T>): number => columnWidths[columns.indexOf(column)]!;

  const cell = (text: string, cellWidth: number, align: "left" | "right"): string => {
    const clipped =
      text.length > cellWidth ? `${text.slice(0, Math.max(0, cellWidth - 1))}…` : text;
    return align === "right" ? clipped.padStart(cellWidth) : clipped.padEnd(cellWidth);
  };

  const header = columns
    .map((column) => {
      const sorted = sorting[0]?.id === column.id ? (sorting[0].desc ? " ▼" : " ▲") : "";
      const label = `${column.header}${sorted}`;
      return cell(label, widthOf(column), column.align ?? "left");
    })
    .join(" ".repeat(gap));

  const visible = rows.slice(from, from + height);
  return (
    <Box flexDirection="column" width={width}>
      <Text bold dimColor={!focused}>
        {cell(header, width, "left")}
      </Text>
      <Box flexDirection="column" ref={bodyRef}>
        {rows.length === 0 ? (
          <Text dimColor>{emptyText}</Text>
        ) : (
          visible.map((row, offset) => {
            const isCursor = from + offset === index;
            const original = row.original;
            const cells = columns.map((column) =>
              cell(
                column.text?.(original) ?? String(column.value(original) ?? ""),
                widthOf(column),
                column.align ?? "left",
              ),
            );
            const used =
              cells.reduce((sum, text) => sum + text.length, 0) + gap * (cells.length - 1);
            return (
              <Text
                key={row.id}
                wrap="truncate"
                inverse={isCursor && focused}
                bold={isCursor && !focused}
              >
                {cells.map((text, at) => {
                  const column = columns[at]!;
                  return (
                    <Text key={column.id}>
                      {at > 0 ? " ".repeat(gap) : null}
                      <Text color={column.color?.(original)} dimColor={column.dim?.(original)}>
                        {text}
                      </Text>
                    </Text>
                  );
                })}
                {used < width ? " ".repeat(width - used) : null}
              </Text>
            );
          })
        )}
      </Box>
      {rows.length > height && (
        <Text dimColor>
          {from + 1}–{Math.min(from + height, rows.length)} of {rows.length}
        </Text>
      )}
    </Box>
  );
}
