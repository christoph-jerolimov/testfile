import React from "react";

// A group of toggles: nothing selected means everything, so the bar starts
// out saying nothing and narrows only when asked to.
export function MultiSelect({
  label,
  options,
  selected,
  onChange,
}: {
  label: string;
  options: string[];
  selected: string[];
  onChange: (values: string[]) => void;
}): React.ReactElement | null {
  if (options.length === 0) return null;
  const toggle = (option: string): void =>
    onChange(
      selected.includes(option)
        ? selected.filter((value) => value !== option)
        : [...selected, option],
    );
  return (
    <div className="filter-group">
      <span className="filter-label">{label}</span>
      {options.map((option) => (
        <button
          key={option}
          className={`chip ${selected.includes(option) ? "on" : ""}`}
          aria-pressed={selected.includes(option)}
          onClick={() => toggle(option)}
        >
          {option}
        </button>
      ))}
    </div>
  );
}

export function SearchInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}): React.ReactElement {
  return (
    <div className="filter-group">
      <span className="filter-label">Search</span>
      <input
        type="search"
        className="filter-text"
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

export const DAY_RANGES = [
  { days: 7, label: "7 days" },
  { days: 30, label: "30 days" },
  { days: 90, label: "90 days" },
  { days: 0, label: "all" },
];

export function DayRange({
  days,
  onChange,
}: {
  days: number;
  onChange: (days: number) => void;
}): React.ReactElement {
  return (
    <div className="filter-group">
      <span className="filter-label">Started</span>
      {DAY_RANGES.map((range) => (
        <button
          key={range.days}
          className={`chip ${days === range.days ? "on" : ""}`}
          aria-pressed={days === range.days}
          onClick={() => onChange(range.days)}
        >
          {range.label}
        </button>
      ))}
    </div>
  );
}

// The bar itself: the toggles, plus how much of the history survives them.
export function FilterBar({
  children,
  shown,
  total,
  noun,
  onClear,
}: {
  children: React.ReactNode;
  shown: number;
  total: number;
  noun: string;
  onClear?: () => void;
}): React.ReactElement {
  return (
    <div className="filters">
      {children}
      <div className="filter-count">
        {shown === total ? `${total} ${noun}` : `${shown} of ${total} ${noun}`}
        {onClear ? (
          <button className="link" onClick={onClear}>
            clear filters
          </button>
        ) : null}
      </div>
    </div>
  );
}
