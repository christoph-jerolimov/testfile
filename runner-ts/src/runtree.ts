import type { TestDef, TestfileDoc } from "./model.js";
import { comboLabel, expandMatrix, type Combination } from "./matrix.js";
import { OutputBuffer } from "./output.js";

export type Status = "pending" | "running" | "passed" | "failed" | "skipped" | "aborted";
export type NodeKind = "command" | "script" | "sequence" | "parallel" | "matrix";

export interface RunNode {
  id: number;
  name: string;
  // Stable identifier across runs: names joined with "/" from the root.
  path: string;
  kind: NodeKind;
  def: TestDef;
  depth: number;
  parent?: RunNode;
  // Matrix values effective for this node (own combination merged over ancestors').
  matrix: Combination;
  // True for the synthetic wrapper that holds one child per matrix combination.
  isMatrixWrapper: boolean;
  children: RunNode[];
  status: Status;
  // The working directory the node actually ran in; used to collect artifacts.
  resolvedCwd?: string;
  // Why a node was skipped: a false `if` condition does not block dependents,
  // a failed `needs` dependency does (failures cascade through chains).
  skipReason?: "condition" | "needs";
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

export function defaultName(def: TestDef): string {
  if (def.name) return def.name;
  if (def.command) return def.command.length > 40 ? `${def.command.slice(0, 37)}...` : def.command;
  return variantOf(def);
}

export function buildRunTree(doc: TestfileDoc): RunNode {
  let nextId = 0;

  function build(
    def: TestDef,
    inheritedMatrix: Combination,
    depth: number,
    parentPath: string,
    expandOwnMatrix: boolean,
    nameOverride?: string
  ): RunNode {
    const name = nameOverride ?? defaultName(def);
    const path = parentPath ? `${parentPath}/${name}` : name;
    if (def.matrix && expandOwnMatrix) {
      const wrapper: RunNode = {
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

    const node: RunNode = {
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
    node.children = children.map((child) => {
      const childNode = build(child, inheritedMatrix, depth + 1, path, true);
      childNode.parent = node;
      return childNode;
    });
    return node;
  }

  return build(doc.test, {}, 0, "", true);
}

// Puts a node back into its initial state so it can run again.
export function resetNode(node: RunNode): void {
  node.status = "pending";
  node.skipReason = undefined;
  node.resolvedCwd = undefined;
  node.timedOut = false;
  node.error = undefined;
  node.startedAt = undefined;
  node.endedAt = undefined;
  node.output.clear();
}

export function walk(node: RunNode, visit: (node: RunNode) => void): void {
  visit(node);
  for (const child of node.children) walk(child, visit);
}
