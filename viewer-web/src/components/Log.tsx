import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ansiLines, cssOf, type AnsiSpan } from "../ansi.js";

// Where every match of the search sits: which line, and where in that line's
// plain text. The indices are global, so "3 of 12" and the ‹ › buttons agree
// with what is highlighted.
interface Match {
  line: number;
  at: number;
  length: number;
}

function findMatches(lines: AnsiSpan[][], query: string): Match[] {
  if (query === "") return [];
  const needle = query.toLowerCase();
  const matches: Match[] = [];
  for (const [line, spans] of lines.entries()) {
    const text = spans
      .map((span) => span.text)
      .join("")
      .toLowerCase();
    for (let at = text.indexOf(needle); at >= 0; at = text.indexOf(needle, at + needle.length)) {
      matches.push({ line, at, length: needle.length });
    }
  }
  return matches;
}

// One span, cut apart wherever the search matches it. The offsets are the
// span's position in its line, so a match spanning a colour change is
// highlighted in both halves rather than in neither.
function Span({
  span,
  from,
  hits,
  active,
}: {
  span: AnsiSpan;
  from: number;
  hits: { at: number; length: number; index: number }[];
  active: number;
}): React.ReactElement {
  const style = cssOf(span.style);
  const parts: React.ReactNode[] = [];
  let at = 0;
  for (const hit of hits) {
    const start = Math.max(0, hit.at - from);
    const end = Math.min(span.text.length, hit.at + hit.length - from);
    if (end <= at) continue;
    if (start > at) parts.push(span.text.slice(at, start));
    parts.push(
      <mark
        key={`${hit.index} ${start}`}
        className={hit.index === active ? "on" : ""}
        data-match={hit.index}
      >
        {span.text.slice(start, end)}
      </mark>,
    );
    at = end;
  }
  if (at < span.text.length) parts.push(span.text.slice(at));
  return <span style={style}>{parts}</span>;
}

export function Log({
  url,
  revision = 0,
  tail,
}: {
  url: string;
  revision?: number;
  // Show only the last `tail` lines, without the search/wrap/follow bar -
  // the excerpt an overview embeds, not a log to work in.
  tail?: number;
}): React.ReactElement {
  const [text, setText] = useState<string | undefined>();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [wrap, setWrap] = useState(true);
  const [follow, setFollow] = useState(false);
  const box = useRef<HTMLPreElement>(null);

  useEffect(() => {
    let alive = true;
    fetch(url)
      .then((response) => (response.ok ? response.text() : `(no log: ${response.status})`))
      .then((body) => {
        if (alive) setText(body);
      })
      .catch(() => alive && setText("(failed to load the log)"));
    return () => {
      alive = false;
    };
    // `revision` is bumped whenever the server reports a change, so a log
    // being written is re-read rather than frozen at its first read.
  }, [url, revision]);

  // a different log starts from the top, with the search still armed
  useEffect(() => setText(undefined), [url]);

  const lines = useMemo(() => {
    const all = ansiLines(text ?? "");
    if (tail === undefined) return all;
    // the trailing newline of a log is not a line worth a slot of the tail
    const last = all[all.length - 1];
    const trimmed = last && last.length === 0 ? all.slice(0, -1) : all;
    return trimmed.slice(-tail);
  }, [text, tail]);
  const matches = useMemo(() => findMatches(lines, query), [lines, query]);
  useEffect(() => setActive(0), [query, url]);

  // Following pins the view to the end; searching wins over it, because a
  // jump the user asked for should not be undone by an arriving line.
  useLayoutEffect(() => {
    if (follow && box.current) box.current.scrollTop = box.current.scrollHeight;
  }, [follow, text]);
  useLayoutEffect(() => {
    const current = box.current?.querySelector(`[data-match="${active}"]`);
    current?.scrollIntoView({ block: "center" });
  }, [active, matches]);

  const step = (by: number): void =>
    setActive((current) => (current + by + matches.length) % Math.max(1, matches.length));

  if (tail !== undefined) {
    return (
      <pre className="log wrap tail">
        {text === undefined
          ? "loading..."
          : lines.map((spans, line) => (
              <Line key={line} spans={spans} matches={matches} line={line} active={active} />
            ))}
      </pre>
    );
  }

  return (
    <>
      <div className="log-bar">
        <input
          type="search"
          className="filter-text"
          value={query}
          placeholder="find in log"
          onChange={(event) => setQuery(event.target.value)}
        />
        {query ? (
          <span className="log-hits">
            {matches.length === 0 ? "no match" : `${active + 1} of ${matches.length}`}
            <button
              className="link"
              aria-label="previous match"
              disabled={matches.length === 0}
              onClick={() => step(-1)}
            >
              ‹
            </button>
            <button
              className="link"
              aria-label="next match"
              disabled={matches.length === 0}
              onClick={() => step(1)}
            >
              ›
            </button>
          </span>
        ) : null}
        <button
          className={`chip ${wrap ? "on" : ""}`}
          aria-pressed={wrap}
          onClick={() => setWrap(!wrap)}
        >
          wrap
        </button>
        <button
          className={`chip ${follow ? "on" : ""}`}
          aria-pressed={follow}
          onClick={() => setFollow(!follow)}
        >
          follow
        </button>
        <span className="log-lines">{text === undefined ? "" : `${lines.length} lines`}</span>
      </div>
      <pre ref={box} className={`log ${wrap ? "wrap" : ""}`}>
        {text === undefined
          ? "loading..."
          : lines.map((spans, line) => (
              <Line key={line} spans={spans} matches={matches} line={line} active={active} />
            ))}
      </pre>
    </>
  );
}

function Line({
  spans,
  matches,
  line,
  active,
}: {
  spans: AnsiSpan[];
  matches: Match[];
  line: number;
  active: number;
}): React.ReactElement {
  let at = 0;
  const hits = matches
    .map((match, index) => ({ ...match, index }))
    .filter((match) => match.line === line);
  return (
    <div className="log-line">
      {spans.length === 0 ? " " : null}
      {spans.map((span, index) => {
        const from = at;
        at += span.text.length;
        return (
          <Span
            key={index}
            span={span}
            from={from}
            active={active}
            hits={hits
              .filter((hit) => hit.at < at && hit.at + hit.length > from)
              .map((hit) => ({ at: hit.at, index: hit.index, length: hit.length }))}
          />
        );
      })}
    </div>
  );
}
