// Everything needed to reproduce one recorded failure, gathered from the
// run's own record.
//
// A red test in CI is a puzzle assembled from several places: which run,
// which leg of a matrix, what environment, which services were up, what
// the log said. Whoever picks the failure up - a person on a laptop or an
// agent asked to fix it - needs all of it at once, and needs the command
// that reruns exactly that test, not the whole suite.
//
// The record is the only source: the viewer never reruns anything and never
// guesses. What the run did not record simply does not appear.
import type {
  RunHistory,
  RunRecord,
  RunRecordFromEnvironment,
  RunRecordSuiteNode,
  RunRecordTest,
} from "./runrecord.js";

export interface ReproService {
  name: string;
  status?: string;
  log?: string;
}

export interface Repro {
  run: {
    id: string;
    startedAt: string;
    status: string;
    machine?: string;
    variants?: Record<string, string>;
    labels?: Record<string, string>;
    // Merged runs: the leg this result came from, which is the run that
    // would have to be reproduced, not the merged one.
    origin?: string;
    // Names the environment handed in; their values were never recorded,
    // so reproducing the run means supplying them again.
    fromEnvironment?: RunRecordFromEnvironment;
  };
  test: {
    path: string;
    status: string;
    durationMs?: number;
    reason?: string;
    // From the recorded suite tree, when the run kept one.
    tags?: string[];
    matrix?: Record<string, string>;
  };
  // The command that reruns this one test, and the environment to run it in.
  command: string;
  env: Record<string, string>;
  // Services the test's suite node (or an ancestor) declared, with what
  // they did in this run.
  services: ReproService[];
  artifacts: string[];
  // The end of the test's log: where a failure usually says why.
  logTail?: string;
}

// A shell-safe single argument: quoted only when it needs to be.
export function shellArg(value: string): string {
  return /^[A-Za-z0-9_@%+=:,./-]+$/.test(value) ? value : `'${value.replaceAll("'", `'\\''`)}'`;
}

// The node of the recorded suite tree for a path, and the tags/services it
// inherits from its ancestors.
function nodeFor(
  suite: RunRecordSuiteNode | undefined,
  path: string,
): { node?: RunRecordSuiteNode; tags: string[]; services: string[] } {
  const found = {
    node: undefined as RunRecordSuiteNode | undefined,
    tags: [] as string[],
    services: [] as string[],
  };
  const walk = (node: RunRecordSuiteNode, tags: string[], services: string[]): void => {
    const onPath = path === node.path || path.startsWith(`${node.path}/`);
    if (!onPath) return;
    const ownTags = [...new Set([...tags, ...(node.tags ?? [])])];
    const ownServices = [...new Set([...services, ...(node.services ?? [])])];
    if (node.path === path) {
      found.node = node;
      found.tags = ownTags;
      found.services = ownServices;
      return;
    }
    for (const child of node.children ?? []) walk(child, ownTags, ownServices);
  };
  if (suite) walk(suite, [], []);
  return found;
}

// The rerun command. `-n <path>` is the narrowest filter the runner has for
// a single test; a matrix instance additionally needs its combination, and
// a run that named an engine or variants needs those to run the same way.
export function reproCommand(
  run: RunRecord,
  testPath: string,
  matrix?: Record<string, string>,
): string {
  const parts = ["testfile", "start", "-n", shellArg(testPath)];
  for (const [key, value] of Object.entries(matrix ?? {})) {
    parts.push("-m", shellArg(`${key}:${value}`));
  }
  for (const [key, value] of Object.entries(run.variants ?? {})) {
    parts.push("--variant", shellArg(`${key}=${value}`));
  }
  return parts.join(" ");
}

// The environment the run recorded, minus what every run sets anyway - a
// reproduction needs what was special about this one.
const ALWAYS_SET = new Set(["CI", "FORCE_COLOR", "TESTFILE_OS"]);

export function reproEnv(run: RunRecord): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(run.env ?? {})) {
    if (!ALWAYS_SET.has(key)) env[key] = value;
  }
  // The overrides are not part of the environment the tests saw, but they
  // are part of how the run was configured - repeating it means setting
  // them again, under the variable they came from.
  for (const override of run.fromEnvironment?.overrides ?? []) {
    env[override.from] = override.value;
  }
  return env;
}

export function tailOf(text: string | undefined, lines: number): string | undefined {
  if (text === undefined || text === "") return undefined;
  const all = text.replace(/\n$/, "").split("\n");
  return all.slice(-lines).join("\n");
}

export function reproOf(
  history: RunHistory,
  run: RunRecord,
  testPath: string,
  options: { logLines?: number; variants?: Record<string, string> } = {},
): Repro {
  const candidates = run.tests.filter((test) => test.path === testPath);
  if (candidates.length === 0) {
    throw new Error(`test "${testPath}" was not executed in run ${run.id}`);
  }
  // A merged run holds one result per leg; --variant picks one, otherwise
  // a failing leg is the interesting one.
  const wanted = options.variants;
  const matching = wanted
    ? candidates.filter((test) =>
        Object.entries(wanted).every(([key, value]) => test.variants?.[key] === value),
      )
    : candidates;
  if (matching.length === 0) {
    const known = candidates
      .map((test) => variantsLabel(test.variants))
      .filter(Boolean)
      .join(", ");
    throw new Error(
      `no result of "${testPath}" in run ${run.id} matches those variants` +
        (known ? ` (recorded: ${known})` : ""),
    );
  }
  const test: RunRecordTest =
    matching.find((candidate) => candidate.status === "failed" || candidate.status === "aborted") ??
    matching[0];

  const { node, tags, services: declared } = nodeFor(run.suite, testPath);
  // A run without a suite tree cannot say which services belong to the
  // test, so it offers all of them rather than none.
  const related = (run.services ?? []).filter(
    (service) =>
      (run.suite === undefined || declared.includes(service.name)) &&
      (test.origin === undefined || service.origin === undefined || service.origin === test.origin),
  );

  return {
    run: {
      id: run.id,
      startedAt: run.startedAt,
      status: run.status,
      ...(run.machine ? { machine: run.machine } : {}),
      ...(run.variants ? { variants: run.variants } : {}),
      ...(run.labels ? { labels: run.labels } : {}),
      ...(test.origin ? { origin: test.origin } : {}),
      ...(run.fromEnvironment ? { fromEnvironment: run.fromEnvironment } : {}),
    },
    test: {
      path: test.path,
      status: test.status,
      ...(test.durationMs !== undefined ? { durationMs: test.durationMs } : {}),
      ...(test.reason ? { reason: test.reason } : {}),
      ...(tags.length > 0 ? { tags } : {}),
      ...(node?.matrix ? { matrix: node.matrix } : {}),
    },
    command: reproCommand(run, testPath, node?.matrix),
    env: reproEnv(run),
    services: related.map((service) => ({
      name: service.name,
      ...(service.status ? { status: service.status } : {}),
      ...(service.log ? { log: service.log } : {}),
    })),
    artifacts: test.artifacts ?? [],
    logTail: tailOf(history.readLog(run, test), options.logLines ?? 40),
  };
}

function variantsLabel(variants?: Record<string, string>): string {
  return Object.entries(variants ?? {})
    .map(([key, value]) => `${key}=${value}`)
    .join(",");
}

// How many artifacts the text form names before it stops listing them.
const ARTIFACT_PREVIEW = 10;

// The bundle as text: shaped to be read top to bottom, then acted on.
export function formatRepro(repro: Repro): string {
  const lines: string[] = [];
  lines.push(`# reproduce ${repro.test.path} from run ${repro.run.id}`);
  lines.push("");
  lines.push(
    `status:    ${repro.test.status}${repro.test.reason ? ` (${repro.test.reason})` : ""}`,
  );
  lines.push(
    `recorded:  ${repro.run.startedAt}${repro.run.machine ? ` on ${repro.run.machine}` : ""}`,
  );
  if (repro.run.origin) lines.push(`leg:       ${repro.run.origin}`);
  const where = variantsLabel(repro.run.variants);
  if (where) lines.push(`variants:  ${where}`);
  const labels = variantsLabel(repro.run.labels);
  if (labels) lines.push(`labels:    ${labels}`);
  const matrix = variantsLabel(repro.test.matrix);
  if (matrix) lines.push(`matrix:    ${matrix}`);
  if (repro.test.tags?.length) lines.push(`tags:      ${repro.test.tags.join(", ")}`);

  lines.push("");
  lines.push("run it with:");
  lines.push("");
  for (const [key, value] of Object.entries(repro.env)) {
    lines.push(`  export ${key}=${shellArg(value)}`);
  }
  lines.push(`  ${repro.command}`);

  // Variables the environment handed in are recorded by name only, so the
  // reader has to supply the values - saying so beats a silent difference.
  const handedIn = repro.run.fromEnvironment;
  if (handedIn?.variables?.length || handedIn?.secrets?.length) {
    lines.push("");
    lines.push("this run was also given (values not recorded):");
    if (handedIn.variables?.length) {
      const named = handedIn.variables.map((name: string) => `TESTFILE_ENV_${name}`);
      lines.push(`  ${named.join(", ")}`);
    }
    if (handedIn.secrets?.length) {
      lines.push(`  ${handedIn.secrets.join(", ")} (secret)`);
    }
  }

  if (repro.services.length > 0) {
    lines.push("");
    lines.push("services this test needs (status in the recorded run):");
    for (const service of repro.services) {
      lines.push(`  ${service.name}${service.status ? ` — ${service.status}` : ""}`);
    }
  }
  if (repro.artifacts.length > 0) {
    lines.push("");
    lines.push("artifacts it kept:");
    // A test that kept a file per case can keep dozens; the point here is
    // that they exist and where they are. --json carries the full list.
    for (const artifact of repro.artifacts.slice(0, ARTIFACT_PREVIEW)) lines.push(`  ${artifact}`);
    const rest = repro.artifacts.length - ARTIFACT_PREVIEW;
    if (rest > 0) lines.push(`  ... and ${rest} more (--json lists them all)`);
  }
  if (repro.logTail) {
    lines.push("");
    lines.push("the end of its log:");
    lines.push("");
    for (const line of repro.logTail.split("\n")) lines.push(`  ${line}`);
  }
  return `${lines.join("\n")}\n`;
}
