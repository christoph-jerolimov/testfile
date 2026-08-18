import React from "react";
import {
  createColumnHelper,
  createCoreRowModel,
  createSortedRowModel,
  rowSortingFeature,
  sortFn_alphanumeric,
  sortFn_basic,
  sortFn_datetime,
  tableFeatures,
  useTable,
  type ColumnDef,
  type RowData,
  type SortingState,
} from "@tanstack/react-table";

// Sorting is the only feature the viewer asks for; the rest of TanStack
// Table stays out of the bundle. `basic` compares numbers, `alphanumeric`
// compares strings with embedded numbers sensibly ("run 2" before "run 10"),
// `datetime` compares timestamps.
export const features = tableFeatures({
  rowSortingFeature,
  coreRowModel: createCoreRowModel(),
  sortedRowModel: createSortedRowModel(),
  sortFns: {
    alphanumeric: sortFn_alphanumeric,
    basic: sortFn_basic,
    datetime: sortFn_datetime,
  },
  // Per-column extras the viewer wants: the class its cells get.
  columnMeta: {} as { className?: string },
});

export type Features = typeof features;

// Each column narrows the value it reads, so the array they end up in has to
// forget that type again - the one place `any` earns its keep.
export type Column<T extends RowData> = ColumnDef<Features, T, any>;

export function columnHelper<T extends RowData>(): ReturnType<
  typeof createColumnHelper<Features, T>
> {
  return createColumnHelper<Features, T>();
}

// Which way the arrow points, and what a screen reader is told about it.
const ARROWS: Record<string, string> = { asc: "▲", desc: "▼" };

export function DataTable<T extends RowData>({
  columns,
  data,
  initialSorting,
  className,
  rowKey,
  rowClassName,
  onRowClick,
  empty,
}: {
  columns: Column<T>[];
  data: T[];
  // How the table reads before anyone clicks a header.
  initialSorting: SortingState;
  className?: string;
  rowKey: (row: T) => string;
  rowClassName?: (row: T) => string;
  onRowClick?: (row: T) => void;
  // Shown instead of rows when there are none.
  empty?: string;
}): React.ReactElement {
  const table = useTable({
    features,
    columns,
    data,
    initialState: { sorting: initialSorting },
    // A table is always sorted by something: clicking a header flips it
    // rather than cycling through an unsorted third state, and every
    // column starts ascending so a click means the same thing everywhere.
    enableSortingRemoval: false,
    sortDescFirst: false,
  });
  const rows = table.getRowModel().rows;
  return (
    <table className={className}>
      <thead>
        {table.getHeaderGroups().map((group) => (
          <tr key={group.id}>
            {group.headers.map((header) => {
              const sorted = header.column.getIsSorted();
              return (
                <th
                  key={header.id}
                  aria-sort={
                    sorted === "asc" ? "ascending" : sorted === "desc" ? "descending" : "none"
                  }
                >
                  <button
                    className={`sort ${sorted ? "on" : ""}`}
                    onClick={header.column.getToggleSortingHandler()}
                    title={`sort by ${header.column.id}`}
                  >
                    <table.FlexRender header={header} />
                    <span className="sort-arrow">{sorted ? ARROWS[sorted] : "↕"}</span>
                  </button>
                </th>
              );
            })}
          </tr>
        ))}
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr
            key={rowKey(row.original)}
            className={rowClassName?.(row.original)}
            onClick={onRowClick ? () => onRowClick(row.original) : undefined}
          >
            {row.getAllCells().map((cell) => (
              <td key={cell.id} className={cell.column.columnDef.meta?.className}>
                <table.FlexRender cell={cell} />
              </td>
            ))}
          </tr>
        ))}
        {rows.length === 0 && empty ? (
          <tr>
            <td className="empty-row" colSpan={columns.length}>
              {empty}
            </td>
          </tr>
        ) : null}
      </tbody>
    </table>
  );
}
