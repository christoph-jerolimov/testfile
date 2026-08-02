import { ResultCache } from "./cache.js";
import { loadEnvFiles } from "./envfile.js";
import { baseEnv as hostBaseEnv, forwardedEnv } from "./hostenv.js";
import type { TestDef } from "./model.js";
import { resolvePorts } from "./ports.js";
import type { RunTest } from "./runsuite.js";
import type { Session } from "./session.js";
import { resolveEnvMap, resolveTemplate, type Scopes } from "./template.js";
import { resolve as resolvePath } from "node:path";

// Predicts, without running anything, which active tests would be served
// from the result cache. Mirrors the executor's scope resolution (env chain,
// env files, workdir, matrix); a test whose resolution fails - or that uses
// values only known at run time, like a freshly allocated random port in its
// command - simply counts as "would run".
// The active tests that would actually execute: everything that is not a
// predicted cache hit. Tests without `inputs` always count as changed.
export async function changedTestIds(session: Session, active: Set<number>): Promise<number[]> {
  const hits = await predictCacheHits(session, active);
  const changed: number[] = [];
  for (const id of active) {
    const test = session.byId.get(id);
    if (test && test.children.length === 0 && !hits.has(id)) changed.push(id);
  }
  return changed;
}

export async function predictCacheHits(session: Session, active: Set<number>): Promise<Set<number>> {
  const hits = new Set<number>();
  if (!session.cache.enabled) return hits;

  const baseEnv = hostBaseEnv([
    ...(session.doc.forwardEnv ?? []),
    ...(session.runDefaults.forwardEnv ?? []),
  ]);
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

  const visit = (test: RunTest, inherited: Scopes, cwd: string): void => {
    if (!active.has(test.id)) return;
    if (test.isMatrixWrapper) {
      for (const child of test.children) visit(child, inherited, cwd);
      return;
    }
    try {
      const where = `test "${test.name}"`;
      const def: TestDef = test.def;
      const matrix = { ...inherited.matrix, ...test.matrix };
      const withMatrix: Scopes = { ...inherited, matrix };
      const forwarded = forwardedEnv(def.forwardEnv);
      const env = { ...withMatrix.env, ...forwarded, ...resolveEnvMap(def.env, withMatrix, where) };
      for (const [key, value] of Object.entries(test.matrix)) {
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
          ...forwarded,
          ...fileEnv,
          ...resolveEnvMap(def.env, withMatrix, where),
        };
        for (const [key, value] of Object.entries(test.matrix)) {
          merged[`TESTFILE_MATRIX_${key.toUpperCase()}`] = value;
        }
        nodeScopes = { ...withMatrix, env: merged };
      }

      if (def.inputs && (test.kind === "command" || test.kind === "script")) {
        const source = resolveTemplate(def.script ?? def.command!, nodeScopes, where);
        const key = ResultCache.configKey(
          test.path,
          source,
          resolveEnvMap(def.env, withMatrix, where),
          test.matrix
        );
        const entry = session.cache.get(key);
        if (entry && entry.hash === ResultCache.inputsHash(nodeCwd, def.inputs)) {
          hits.add(test.id);
        }
      }
      for (const child of test.children) visit(child, nodeScopes, nodeCwd);
    } catch {
      // unresolvable here means it would run; descend no further
    }
  };

  visit(session.suite, scopes, session.baseDir);
  return hits;
}
