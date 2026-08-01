import React from "react";
import { Text } from "ink";
import type { Session } from "../session.js";
import { testHistoryLines, type PaneContent, type RecordedTest } from "./model.js";
import { NODE_GLYPH } from "./tests-view.js";

// Every test that appears in a recorded run - independent of the current
// Testfile - with its aggregated outcomes. Selecting one shows the table of
// its executions across all runs.
export function ResultsPane({
  tests,
  index,
}: {
  tests: RecordedTest[];
  index: number;
}): React.ReactElement {
  return (
    <>
      <Text bold color="cyan">
        RECORDED TESTS
      </Text>
      {tests.length === 0 ? <Text dimColor>no recorded runs yet</Text> : null}
      {tests.map((test, i) => {
        const g = NODE_GLYPH[test.lastStatus];
        return (
          <Text key={test.path} inverse={i === index} wrap="truncate">
            <Text color={g.color}>{g.glyph}</Text> {test.path}
            <Text dimColor>
              {" "}
              {test.passes}✔ {test.fails}✘ of {test.occurrences}
            </Text>
          </Text>
        );
      })}
    </>
  );
}

export function resultsPaneContent(test: RecordedTest | undefined, session: Session): PaneContent {
  if (!test) {
    return { title: "results", lines: [{ text: "no recorded runs yet", stream: "system" }] };
  }
  return {
    title: test.path,
    note: "all recorded executions",
    lines: testHistoryLines(test.path, session.history),
  };
}
