import React, { useMemo, useState } from "react";
import {
  filterTests,
  isDefaultTestFilter,
  tagOptions,
  tagsByPath,
  testFilterDefaults,
  testStatusOptions,
  type TestFilter,
} from "../filters.js";
import { aggregate, formatMs, isFlaky, startedLabel, variantLabel } from "../format.js";
import { navigate } from "../router.js";
import type { RunRecord, RunTest } from "../types.js";
import { FilterBar, MultiSelect, SearchInput, Toggle } from "./FilterBar.js";
import { Sparkline } from "./Sparkline.js";
import { StatusCell } from "./StatusCell.js";

export function ResultsView({
  runs,
  selected,
}: {
  runs: RunRecord[];
  // The test path from the URL; the first test stands in until one is picked.
  selected?: string;
}): React.ReactElement {
  const [filter, setFilter] = useState<TestFilter>(testFilterDefaults);
  const tests = useMemo(() => aggregate(runs), [runs]);
  const tags = useMemo(() => tagsByPath(runs), [runs]);
  const shown = useMemo(() => filterTests(tests, filter, tags), [tests, filter, tags]);
  // as on the runs tab, a linked test stays visible even when filtered out
  const current = tests.find((t) => t.path === selected) ?? shown[0] ?? tests[0];
  if (!current) return <div className="empty">no recorded runs yet — run some tests first</div>;
  // A merged run holds one result per leg, so a run can contribute more
  // than one execution of the same test.
  const executions: { run: RunRecord; test: RunTest }[] = runs.flatMap((run) =>
    run.tests.filter((t) => t.path === current.path).map((test) => ({ run, test })),
  );
  return (
    <main>
      <div className="list">
        <FilterBar
          shown={shown.length}
          total={tests.length}
          noun="tests"
          onClear={isDefaultTestFilter(filter) ? undefined : () => setFilter(testFilterDefaults)}
        >
          <MultiSelect
            label="Status"
            options={testStatusOptions(tests)}
            selected={filter.statuses}
            onChange={(statuses) => setFilter({ ...filter, statuses })}
          />
          <MultiSelect
            label="Tags"
            options={tagOptions(runs)}
            selected={filter.tags}
            onChange={(values) => setFilter({ ...filter, tags: values })}
          />
          <Toggle
            label="flaky only"
            on={filter.flakyOnly}
            onChange={(flakyOnly) => setFilter({ ...filter, flakyOnly })}
          />
          <SearchInput
            value={filter.text}
            placeholder="test path or tag"
            onChange={(text) => setFilter({ ...filter, text })}
          />
        </FilterBar>
        <table>
          <thead>
            <tr>
              <th>Test</th>
              <th>Last</th>
              <th>History</th>
              <th>Passed</th>
              <th>Failed</th>
              <th>Runs</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((t) => (
              <tr
                key={t.path}
                className={`row ${t.path === current.path ? "selected" : ""}`}
                onClick={() => navigate({ view: "results", testPath: t.path })}
              >
                <td className="mono">
                  {t.path}
                  {isFlaky(t) ? <span className="badge flaky">flaky</span> : null}
                </td>
                <td>
                  <StatusCell status={t.lastStatus} />
                </td>
                <td>
                  <Sparkline history={t.history} />
                </td>
                <td>{t.passes}</td>
                <td>{t.fails}</td>
                <td>{t.occurrences}</td>
              </tr>
            ))}
            {shown.length === 0 ? (
              <tr>
                <td className="empty-row" colSpan={6}>
                  no test matches the filters
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <div className="detail">
        <h2>
          executions of <span className="mono">{current.path}</span>
          {isFlaky(current) ? <span className="badge flaky">flaky</span> : null}
          {(tags.get(current.path) ?? []).map((tag) => (
            <span key={tag} className="badge">
              {tag}
            </span>
          ))}
        </h2>
        <table>
          <thead>
            <tr>
              <th>Run</th>
              <th>Started</th>
              <th>Status</th>
              <th>Duration</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            {executions.map(({ run, test }) => (
              <tr key={`${run.id} ${test.origin ?? ""}`}>
                <td className="mono">
                  {run.id}
                  {variantLabel(test.variants) ? (
                    <span className="variant">{variantLabel(test.variants)}</span>
                  ) : null}
                </td>
                <td className="mono">{startedLabel(run.startedAt)}</td>
                <td>
                  <StatusCell status={test.status} cached={test.cached} />
                </td>
                <td>{formatMs(test.durationMs)}</td>
                <td>
                  {test.artifacts?.length ? (
                    <span className="badge">{test.artifacts.length} artifacts</span>
                  ) : null}
                  {test.log ? <span className="badge">log</span> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
