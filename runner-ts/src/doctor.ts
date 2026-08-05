// "Why doesn't this work on my machine?" - the checks that answer it.
//
// A Testfile can ask for a container engine, for fixed ports, for git (the
// change-based selection) and always for a writable .testfile/ folder. Each
// of those fails in its own way, usually in the middle of a run. `testfile
// doctor` looks at what the Testfile actually needs and reports the state of
// each requirement before a single test starts.
//
// The checks are pure functions over an injected environment (probing a
// command, binding a port, writing a file), so the tests can describe a
// machine instead of requiring one.
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import type { ServiceDef, TestDef, TestfileDoc } from "./model.js";

export type CheckStatus = "ok" | "warn" | "fail";

export interface Check {
  // Short identifier, e.g. "node", "git", "container-engine", "port web".
  name: string;
  status: CheckStatus;
  // What was found.
  detail: string;
  // What to do about it; set on warnings and failures.
  hint?: string;
}

// The bits of the machine the checks look at. Every one of them is a seam.
export interface DoctorEnv {
  // Runs `<command> <args>` and reports whether it succeeded, with its
  // first line of output.
  probe(command: string, args: string[]): { ok: boolean; output: string };
  // Whether a TCP port can be bound on localhost right now.
  canBind(port: number): Promise<boolean>;
  // Undefined when the folder could be created and written to, the reason
  // otherwise.
  writeTest(dir: string): string | undefined;
  nodeVersion: string;
  platform: string;
}

export const MIN_NODE_MAJOR = 20;

export const realEnv: DoctorEnv = {
  probe(command, args) {
    try {
      const result = spawnSync(command, args, { encoding: "utf8", timeout: 15_000 });
      const out = (result.stdout ?? "").trim();
      const err = (result.stderr ?? "").trim();
      const ok = result.status === 0;
      // a failure explains itself on stderr (docker prints client details on
      // stdout even when it cannot reach the daemon)
      const text = result.error?.message ?? (ok ? out || err : err || out);
      return { ok, output: text.split("\n")[0] ?? "" };
    } catch (err) {
      return { ok: false, output: err instanceof Error ? err.message : String(err) };
    }
  },
  canBind(port) {
    return new Promise((resolve) => {
      const server = createServer();
      server.once("error", () => resolve(false));
      server.listen(port, "127.0.0.1", () => server.close(() => resolve(true)));
    });
  },
  writeTest(dir) {
    const probe = join(dir, ".doctor-probe");
    try {
      mkdirSync(dir, { recursive: true });
      // the folder ignores itself, exactly as a recorded run leaves it -
      // checking must not leave something that ends up in a commit
      writeFileSync(join(dir, ".gitignore"), "*\n");
      writeFileSync(probe, "");
      rmSync(probe, { force: true });
      return undefined;
    } catch (err) {
      return err instanceof Error ? err.message : String(err);
    }
  },
  nodeVersion: process.version,
  platform: process.platform,
};

function walkTests(test: TestDef | undefined, visit: (test: TestDef) => void): void {
  if (!test) return;
  visit(test);
  for (const child of [...(test.sequence ?? []), ...(test.parallel ?? [])]) walkTests(child, visit);
  walkTests(test.template, visit);
}

function servicesOf(doc: TestfileDoc): ServiceDef[] {
  const services = Object.values(doc.services ?? {});
  walkTests(doc.test, (test) => services.push(...Object.values(test.services ?? {})));
  return services;
}

// Which engine (if any) the Testfile asks for: an explicit `engine:` wins,
// otherwise the run needs whichever one is installed.
export function containerNeeds(doc: TestfileDoc): { needed: boolean; engines: string[] } {
  const engines = new Set<string>();
  let needed = false;
  const note = (def: { engine?: string } | undefined): void => {
    if (!def) return;
    needed = true;
    if (def.engine && def.engine !== "auto") engines.add(def.engine);
  };
  for (const service of servicesOf(doc)) note(service.container);
  walkTests(doc.test, (test) => note(test.container));
  return { needed, engines: [...engines].sort() };
}

// The ports the Testfile pins; "random" ones are allocated by the runner and
// cannot clash.
export function fixedPorts(doc: TestfileDoc): { name: string; port: number }[] {
  return Object.entries(doc.ports ?? {})
    .filter(([, value]) => typeof value === "number")
    .map(([name, value]) => ({ name, port: value as number }));
}

// The shells the Testfile invokes: "sh" unless a test names another one.
export function shellsUsed(doc: TestfileDoc): string[] {
  const shells = new Set<string>();
  let usesDefault = false;
  walkTests(doc.test, (test) => {
    if (test.command === undefined && test.script === undefined) return;
    if (test.shell) shells.add(test.shell.split(/\s+/)[0]);
    else usesDefault = true;
  });
  if (usesDefault) shells.add("sh");
  // a templated shell (${{ ... }}) is only known at run time
  return [...shells].filter((shell) => !shell.includes("${{")).sort();
}

function nodeCheck(env: DoctorEnv): Check {
  const major = Number(/^v(\d+)/.exec(env.nodeVersion)?.[1] ?? 0);
  if (major >= MIN_NODE_MAJOR) return { name: "node", status: "ok", detail: env.nodeVersion };
  return {
    name: "node",
    status: "fail",
    detail: `${env.nodeVersion}, the runner needs ${MIN_NODE_MAJOR} or newer`,
    hint: `install Node.js ${MIN_NODE_MAJOR}+ (nvm install ${MIN_NODE_MAJOR})`,
  };
}

function gitChecks(env: DoctorEnv, baseDir: string): Check[] {
  const version = env.probe("git", ["--version"]);
  if (!version.ok) {
    return [
      {
        name: "git",
        status: "warn",
        detail: "not found",
        hint: "--changed and `testfile changes` need git; everything else works without it",
      },
    ];
  }
  const repo = env.probe("git", ["-C", baseDir, "rev-parse", "--is-inside-work-tree"]);
  const checks: Check[] = [{ name: "git", status: "ok", detail: version.output }];
  if (!repo.ok || repo.output.trim() !== "true") {
    checks.push({
      name: "git repository",
      status: "warn",
      detail: `${baseDir} is not inside a git work tree`,
      hint: "--changed and `testfile changes` compare against a git ref",
    });
  }
  return checks;
}

function containerChecks(env: DoctorEnv, doc: TestfileDoc | undefined): Check[] {
  const needs = doc ? containerNeeds(doc) : { needed: false, engines: [] as string[] };
  const candidates = needs.engines.length > 0 ? needs.engines : ["podman", "docker"];
  const found = candidates.filter((engine) => env.probe(engine, ["--version"]).ok);

  // Nothing asks for a container: say what is there and move on instead of
  // waking a daemon nothing is going to talk to.
  if (!needs.needed) {
    const installed = found.length > 0 ? `${found.join(", ")} installed` : "none installed";
    return [
      {
        name: "container engine",
        status: "ok",
        detail: doc
          ? `not needed, this Testfile starts no containers (${installed})`
          : `${installed} (no Testfile to read)`,
      },
    ];
  }

  if (found.length === 0) {
    return [
      {
        name: "container engine",
        status: "fail",
        detail: `none of ${candidates.join(", ")} found`,
        hint: `this Testfile runs containers - install ${candidates.join(" or ")}`,
      },
    ];
  }

  return found.map((engine) => {
    const info = env.probe(engine, ["info"]);
    if (info.ok) {
      return {
        name: `container engine (${engine})`,
        status: "ok",
        detail: "installed, responding",
      };
    }
    return {
      name: `container engine (${engine})`,
      status: "fail",
      detail: `installed, but "${engine} info" failed: ${info.output}`,
      hint: engine === "docker" ? "is the Docker daemon running?" : `start the ${engine} machine`,
    };
  });
}

async function portChecks(env: DoctorEnv, doc: TestfileDoc | undefined): Promise<Check[]> {
  const ports = doc ? fixedPorts(doc) : [];
  if (ports.length === 0) {
    return [
      {
        name: "ports",
        status: "ok",
        detail: doc ? "no fixed ports - the runner allocates free ones" : "no Testfile to read",
      },
    ];
  }
  const checks: Check[] = [];
  for (const { name, port } of ports) {
    const free = await env.canBind(port);
    checks.push(
      free
        ? { name: `port ${name}`, status: "ok", detail: `${port} is free` }
        : {
            name: `port ${name}`,
            status: "fail",
            detail: `${port} is already in use`,
            hint: `stop what listens on ${port}, or declare "${name}: random" and template the value`,
          },
    );
  }
  return checks;
}

function historyCheck(env: DoctorEnv, baseDir: string): Check {
  const dir = join(baseDir, ".testfile");
  const problem = env.writeTest(dir);
  if (!problem) return { name: ".testfile/", status: "ok", detail: `${dir} is writable` };
  return {
    name: ".testfile/",
    status: "fail",
    detail: `${dir} is not writable: ${problem}`,
    hint: "runs are recorded there; check the folder's permissions",
  };
}

function shellChecks(env: DoctorEnv, doc: TestfileDoc | undefined): Check[] {
  if (!doc) return [];
  return shellsUsed(doc).map((shell) => {
    const probe = env.probe(shell, ["-c", "exit 0"]);
    if (probe.ok) return { name: `shell (${shell})`, status: "ok", detail: "on PATH" };
    return {
      name: `shell (${shell})`,
      status: "fail",
      detail: `${shell} could not be started: ${probe.output}`,
      hint:
        shell === "sh" && env.platform === "win32"
          ? "tests run through sh -c; install Git for Windows and put its bin/ on PATH"
          : `install ${shell} or set another "shell:" on the test`,
    };
  });
}

// Everything above, in the order the output shows them. `doc` is undefined
// when no Testfile was found - the machine checks still apply.
export async function runChecks(
  doc: TestfileDoc | undefined,
  baseDir: string,
  env: DoctorEnv = realEnv,
): Promise<Check[]> {
  return [
    nodeCheck(env),
    ...gitChecks(env, baseDir),
    ...shellChecks(env, doc),
    ...containerChecks(env, doc),
    ...(await portChecks(env, doc)),
    historyCheck(env, baseDir),
  ];
}

export function worstOf(checks: readonly Check[]): CheckStatus {
  if (checks.some((check) => check.status === "fail")) return "fail";
  if (checks.some((check) => check.status === "warn")) return "warn";
  return "ok";
}
