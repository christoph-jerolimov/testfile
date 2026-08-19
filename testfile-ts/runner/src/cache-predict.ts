import { ResultCache } from "./cache.js";
import { loadEnvFiles } from "./envfile.js";
import { describeMatches, matchChangedInputs, type GitChanges } from "./gitchanges.js";
import { baseEnv as hostBaseEnv, forwardedEnv } from "./hostenv.js";
import type { TestDef } from "./model.js";
import { fixedPortValues, resolvePorts } from "./ports.js";
import type { RunTest } from "./runsuite.js";
import type { Session } from "./session.js";
import { resolveEnvMap, resolveTemplate, type Scopes } from "./template.js";
import { resolve as resolvePath } from "node:path";

// Walks the active suite without running anything, mirroring the executor's
// scope resolution (env chain, env files, workdir, matrix), and calls the
// visitor with each test's resolved scopes and working directory. A subtree
// whose resolution fails - e.g. it uses values only known at run time, like
// a freshly allocated random port in its command - is reported through
// onUnresolvable and not descended into.
interface ResolvedContext {
  // The test's fully resolved scopes (own env, env files, matrix applied).
  scopes: Scopes;
  cwd: string;
  // The scopes the test's own `env` resolves against (parent env + matrix),
  // needed to reproduce the executor's cache config key exactly.
  parentScopes: Scopes;
}

async function visitResolved(
  session: Session,
  active: Set<number>,
  visitor: (test: RunTest, ctx: ResolvedContext) => void,
  onUnresolvable?: (test: RunTest) => void,
): Promise<boolean> {
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
    const fileEnv = loadEnvFiles(
      session.doc.envFile,
      session.baseDir,
      bootstrap,
      "Testfile",
      new Set(),
    );
    const withFiles = { ...baseEnv, ...fileEnv };
    const docEnv = resolveEnvMap(session.doc.env, { ...bootstrap, env: withFiles }, "Testfile");
    scopes = { ...bootstrap, env: { ...withFiles, ...docEnv } };
  } catch {
    return false;
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
      // Of the test's own ports only fixed ones resolve here; a "random"
      // port is allocated fresh per run, so anything referencing it cannot
      // reproduce a cached configuration and correctly reads as
      // unresolvable.
      const ports = def.ports ? { ...inherited.ports, ...fixedPortValues(def.ports) } : undefined;
      const withMatrix: Scopes = ports ? { ...inherited, matrix, ports } : { ...inherited, matrix };
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

      visitor(test, { scopes: nodeScopes, cwd: nodeCwd, parentScopes: withMatrix });
      for (const child of test.children) visit(child, nodeScopes, nodeCwd);
    } catch {
      onUnresolvable?.(test);
    }
  };

  visit(session.suite, scopes, session.baseDir);
  return true;
}

// Predicts, without running anything, which active tests would be served
// from the result cache (used by --dry-run).
export async function predictCacheHits(
  session: Session,
  active: Set<number>,
): Promise<Set<number>> {
  const hits = new Set<number>();
  if (!session.cache.enabled) return hits;

  await visitResolved(session, active, (test, { scopes, cwd, parentScopes }) => {
    const def = test.def;
    if (!def.inputs || (test.kind !== "command" && test.kind !== "script")) return;
    const where = `test "${test.name}"`;
    const source = resolveTemplate(def.script ?? def.command!, scopes, where);
    const key = ResultCache.configKey(
      test.path,
      source,
      resolveEnvMap(def.env, parentScopes, where),
      test.matrix,
    );
    const entry = session.cache.get(key);
    if (entry && entry.hash === ResultCache.inputsState(cwd, def.inputs).hash) {
      hits.add(test.id);
    }
  });
  return hits;
}

// Git-based test selection for --changed: a leaf test is selected when it
// declares no `inputs` (the runner cannot know what it depends on) or when
// any changed file - committed since the base branch, or dirty in the
// working copy - matches one of its input patterns. The notes say which
// pattern matched what, for the logs and the run record.
export async function gitChangedSelection(
  session: Session,
  active: Set<number>,
  changes: GitChanges,
): Promise<{ ids: number[]; notes: Map<number, string> }> {
  const ids: number[] = [];
  const notes = new Map<number, string>();
  const select = (test: RunTest): void => {
    ids.push(test.id);
  };

  const resolved = await visitResolved(
    session,
    active,
    (test, { cwd }) => {
      if (test.children.length > 0) return;
      if (!test.def.inputs || (test.kind !== "command" && test.kind !== "script")) {
        select(test);
        return;
      }
      const matches = matchChangedInputs(changes, cwd, test.def.inputs);
      if (matches.length > 0) {
        notes.set(
          test.id,
          `selected by --changed against ${changes.baseRef}: ${describeMatches(matches)}`,
        );
        select(test);
      }
    },
    // unresolvable subtrees count as changed: they would run
    (test) => {
      for (const leaf of collectLeaves(test)) {
        if (active.has(leaf.id)) select(leaf);
      }
    },
  );
  if (!resolved) {
    // top-level resolution failed; run everything selected rather than
    // silently skipping tests
    for (const leaf of collectLeaves(session.suite)) {
      if (active.has(leaf.id)) select(leaf);
    }
  }
  return { ids, notes };
}

function collectLeaves(test: RunTest): RunTest[] {
  if (test.children.length === 0) return [test];
  return test.children.flatMap(collectLeaves);
}
