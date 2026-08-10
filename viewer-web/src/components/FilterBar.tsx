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

// How many values a label key may have before its chips become a dropdown.
const CHIP_LIMIT = 3;

// The labels filter: chips while a key has few values, a dropdown once it
// has more than CHIP_LIMIT - a branch or sha key would otherwise flood the
// bar with one chip per value. A dropdown picks one value per key ("any"
// clears it); chips keep their multi-select behavior.
export function LabelSelect({
  options,
  selected,
  onChange,
}: {
  // key=value strings, as labelOptions() lists them.
  options: string[];
  selected: string[];
  onChange: (values: string[]) => void;
}): React.ReactElement | null {
  if (options.length === 0) return null;
  const byKey = new Map<string, string[]>();
  for (const option of options) {
    const at = option.indexOf("=");
    const key = at === -1 ? option : option.slice(0, at);
    byKey.set(key, [...(byKey.get(key) ?? []), option]);
  }
  const chips = [...byKey.values()].filter((values) => values.length <= CHIP_LIMIT).flat();
  const dropdowns = [...byKey.entries()].filter(([, values]) => values.length > CHIP_LIMIT);
  const toggle = (option: string): void =>
    onChange(
      selected.includes(option)
        ? selected.filter((value) => value !== option)
        : [...selected, option],
    );
  const pick = (key: string, option: string): void =>
    onChange([
      ...selected.filter((value) => !value.startsWith(`${key}=`) && value !== key),
      ...(option ? [option] : []),
    ]);
  return (
    <div className="filter-group">
      <span className="filter-label">Labels</span>
      {chips.map((option) => (
        <button
          key={option}
          className={`chip ${selected.includes(option) ? "on" : ""}`}
          aria-pressed={selected.includes(option)}
          onClick={() => toggle(option)}
        >
          {option}
        </button>
      ))}
      {dropdowns.map(([key, values]) => {
        const active = selected.find((value) => values.includes(value)) ?? "";
        return (
          <select
            key={key}
            className={`filter-select ${active ? "on" : ""}`}
            aria-label={`filter by ${key}`}
            value={active}
            onChange={(event) => pick(key, event.target.value)}
          >
            <option value="">{key}: any</option>
            {values.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        );
      })}
    </div>
  );
}

// A single on/off chip, for filters that are a yes/no rather than a choice.
export function Toggle({
  label,
  on,
  onChange,
}: {
  label: string;
  on: boolean;
  onChange: (on: boolean) => void;
}): React.ReactElement {
  return (
    <div className="filter-group">
      <button className={`chip ${on ? "on" : ""}`} aria-pressed={on} onClick={() => onChange(!on)}>
        {label}
      </button>
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
