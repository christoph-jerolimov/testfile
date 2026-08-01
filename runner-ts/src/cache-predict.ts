import { ResultCache } from "./cache.js";
import { loadEnvFiles } from "./envfile.js";
import type { TestDef } from "./model.js";
import { resolvePorts } from "./ports.js";
import type { RunNode } from "./runtree.js";
import type { Session } from "./session.js";
import { resolveEnvMap, resolveTemplate, type Scopes } from "./template.js";
import { resolve as resolvePath } from "node:path";

// Predicts, without running anything, which active leaves would be served
// from the result cache. Mirrors the executor's scope resolution (env chain,
// env files, workdir, matrix); a node whose resolution fails - or that uses
// values only known at run time, like a freshly allocated random port in its
// command - simply counts as "would run".
// The active leaves that would actually execute: everything that is not a
// predicted cache hit. Tests without `inputs` always count as changed.
export async function changedLeafIds(session: Session, active: Set<number>): Promise<number[]> {
  const hits = await predictCacheHits(session, active);
  const changed: number[] = [];
  for (const id of active) {
    const node = session.byId.get(id);
    if (node && node.children.length === 0 && !hits.has(id)) changed.push(id);
  }
  return changed;
}

export async function predictCacheHits(session: Session, active: Set<number>): Promise<Set<number>> {
  const hits = new Set<number>();
  if (!session.cache.enabled) return hits;

  const baseEnv: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) baseEnv[key] = value;
  }
  baseEnv.TESTFILE_OS = process.platform;
  baseEnv.TESTFILE_ARCH = process.arch;

  let scopes: Scopes;
  try {
    const ports = await resolvePorts(session.doc.ports);
    const bootstrap: Scopes = { env: baseEnv, ports, matrix: {} };
    const fileEnv = loadEnvFiles(session.doc.envFile, session.baseDir, bootstrap, "Testfile", new Set());
    const withFiles = { ...baseEnv, ...fileEnv };
    const docEnv = resolveEnvMap(session.doc.env, { ...bootstrap, env: withFiles }, "Testfile");
    scopes = { ...bootstrap, env: { ...withFiles, ...docEnv } };
  } catch {
    return hits;
  }

  const visit = (node: RunNode, inherited: Scopes, cwd: string): void => {
    if (!active.has(node.id)) return;
    if (node.isMatrixWrapper) {
      for (const child of node.children) visit(child, inherited, cwd);
      return;
    }
    try {
      const where = `test "${node.name}"`;
      const def: TestDef = node.def;
      const matrix = { ...inherited.matrix, ...node.matrix };
      const withMatrix: Scopes = { ...inherited, matrix };
      const env = { ...withMatrix.env, ...resolveEnvMap(def.env, withMatrix, where) };
      for (const [key, value] of Object.entries(node.matrix)) {
        env[`TESTFILE_MATRIX_${key.toUpperCase()}`] = value;
      }
      let nodeScopes: Scopes = { ...withMatrix, env };
      const nodeCwd = def.workdir
        ? resolvePath(cwd, resolveTemplate(def.workdir, nodeScopes, where))
        : cwd;
      if (def.envFile !== undefined) {
        const fileEnv = loadEnvFiles(def.envFile, nodeCwd, nodeScopes, where, new Set());
        const merged = {
          ...withMatrix.env,
          ...fileEnv,
          ...resolveEnvMap(def.env, withMatrix, where),
        };
        for (const [key, value] of Object.entries(node.matrix)) {
          merged[`TESTFILE_MATRIX_${key.toUpperCase()}`] = value;
        }
        nodeScopes = { ...withMatrix, env: merged };
      }

      if (def.inputs && (node.kind === "command" || node.kind === "script")) {
        const source = resolveTemplate(def.script ?? def.command!, nodeScopes, where);
        const key = ResultCache.configKey(
          node.path,
          source,
          resolveEnvMap(def.env, withMatrix, where),
          node.matrix
        );
        const entry = session.cache.get(key);
        if (entry && entry.hash === ResultCache.inputsHash(nodeCwd, def.inputs)) {
          hits.add(node.id);
        }
      }
      for (const child of node.children) visit(child, nodeScopes, nodeCwd);
    } catch {
      // unresolvable here means it would run; descend no further
    }
  };

  visit(session.tree, scopes, session.baseDir);
  return hits;
}
