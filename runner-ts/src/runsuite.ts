import type { TestDef, TestfileDoc } from "./model.js";
import { comboLabel, expandMatrix, type Combination } from "./matrix.js";
import { OutputBuffer } from "./output.js";

export type Status = "pending" | "running" | "passed" | "failed" | "skipped" | "aborted";
export type TestKind = "command" | "script" | "sequence" | "parallel" | "matrix";

export interface RunTest {
  id: number;
  name: string;
  // Stable identifier across runs: names joined with "/" from the root.
  path: string;
  kind: TestKind;
  def: TestDef;
  depth: number;
  parent?: RunTest;
  // Matrix values effective for this test (own combination merged over ancestors').
  matrix: Combination;
  // True for the synthetic wrapper that holds one child per matrix combination.
  isMatrixWrapper: boolean;
  children: RunTest[];
  status: Status;
  // True when the result was reused from the cache (inputs unchanged).
  cached?: boolean;
  // For tests with `inputs`: why the test ran or was served from the cache
  // (cache hit/miss detail, --changed selection); recorded in run.yaml.
  reason?: string;
  // The working directory the test actually ran in; used to collect artifacts.
  resolvedCwd?: string;
  // Why a test was skipped: a false `if` condition does not block dependents,
  // a failed `needs` dependency does (failures cascade through chains).
  skipReason?: "condition" | "needs";
  timedOut: boolean;
  output: OutputBuffer;
  error?: string;
  startedAt?: number;
  endedAt?: number;
}

function variantOf(def: TestDef): TestKind {
  if (def.command !== undefined) return "command";
  if (def.script !== undefined) return "script";
  if (def.sequence !== undefined) return "sequence";
  return "parallel";
}

export function defaultName(def: TestDef): string {
  if (def.name) return def.name;
  if (def.command) return def.command.length > 40 ? `${def.command.slice(0, 37)}...` : def.command;
  return variantOf(def);
}

export function buildRunSuite(doc: TestfileDoc): RunTest {
  let nextId = 0;

  function build(
    def: TestDef,
    inheritedMatrix: Combination,
    depth: number,
    parentPath: string,
    expandOwnMatrix: boolean,
    nameOverride?: string
  ): RunTest {
    const name = nameOverride ?? defaultName(def);
    const path = parentPath ? `${parentPath}/${name}` : name;
    if (def.matrix && expandOwnMatrix) {
      const wrapper: RunTest = {
        id: nextId++,
        name,
        path,
        kind: "matrix",
        def,
        depth,
        matrix: inheritedMatrix,
        isMatrixWrapper: true,
        children: [],
        status: "pending",
        timedOut: false,
        output: new OutputBuffer(),
      };
      wrapper.children = expandMatrix(def.matrix).map((combo) => {
        const instance = build(
          def,
          { ...inheritedMatrix, ...combo },
          depth + 1,
          path,
          false,
          `${defaultName(def)} (${comboLabel(combo)})`
        );
        instance.parent = wrapper;
        return instance;
      });
      return wrapper;
    }

    const test: RunTest = {
      id: nextId++,
      name,
      path,
      kind: variantOf(def),
      def,
      depth,
      matrix: inheritedMatrix,
      isMatrixWrapper: false,
      children: [],
      status: "pending",
      timedOut: false,
      output: new OutputBuffer(),
    };
    const children = def.sequence ?? def.parallel ?? [];
    test.children = children.map((child) => {
      const childTest = build(child, inheritedMatrix, depth + 1, path, true);
      childTest.parent = test;
      return childTest;
    });
    return test;
  }

  return build(doc.test, {}, 0, "", true);
}

// Puts a test back into its initial state so it can run again.
export function resetTest(test: RunTest): void {
  test.status = "pending";
  test.cached = undefined;
  test.reason = undefined;
  test.skipReason = undefined;
  test.resolvedCwd = undefined;
  test.timedOut = false;
  test.error = undefined;
  test.startedAt = undefined;
  test.endedAt = undefined;
  test.output.clear();
}

export function walk(test: RunTest, visit: (test: RunTest) => void): void {
  visit(test);
  for (const child of test.children) walk(child, visit);
}
