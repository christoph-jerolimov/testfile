import type { TestDef, TestfileDoc } from "./model.js";
import { comboLabel, expandMatrix, type Combination } from "./matrix.js";
import { OutputBuffer } from "./output.js";

export type Status = "pending" | "running" | "passed" | "failed" | "skipped" | "aborted";
export type NodeKind = "command" | "script" | "sequence" | "parallel" | "matrix";

export interface RunNode {
  id: number;
  name: string;
  kind: NodeKind;
  def: TestDef;
  depth: number;
  // Matrix values effective for this node (own combination merged over ancestors').
  matrix: Combination;
  // True for the synthetic wrapper that holds one child per matrix combination.
  isMatrixWrapper: boolean;
  children: RunNode[];
  status: Status;
  timedOut: boolean;
  output: OutputBuffer;
  error?: string;
  startedAt?: number;
  endedAt?: number;
}

function variantOf(def: TestDef): NodeKind {
  if (def.command !== undefined) return "command";
  if (def.script !== undefined) return "script";
  if (def.sequence !== undefined) return "sequence";
  return "parallel";
}

function defaultName(def: TestDef): string {
  if (def.name) return def.name;
  if (def.command) return def.command.length > 40 ? `${def.command.slice(0, 37)}...` : def.command;
  return variantOf(def);
}

export function buildRunTree(doc: TestfileDoc): RunNode {
  let nextId = 0;

  function build(def: TestDef, inheritedMatrix: Combination, depth: number, expandOwnMatrix: boolean): RunNode {
    if (def.matrix && expandOwnMatrix) {
      const combos = expandMatrix(def.matrix);
      const wrapper: RunNode = {
        id: nextId++,
        name: defaultName(def),
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
      wrapper.children = combos.map((combo) => {
        const instance = build(def, { ...inheritedMatrix, ...combo }, depth + 1, false);
        instance.name = `${defaultName(def)} (${comboLabel(combo)})`;
        return instance;
      });
      return wrapper;
    }

    const kind = variantOf(def);
    const node: RunNode = {
      id: nextId++,
      name: defaultName(def),
      kind,
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
    node.children = children.map((child) => build(child, inheritedMatrix, depth + 1, true));
    return node;
  }

  return build(doc.test, {}, 0, true);
}

export function walk(node: RunNode, visit: (node: RunNode) => void): void {
  visit(node);
  for (const child of node.children) walk(child, visit);
}
