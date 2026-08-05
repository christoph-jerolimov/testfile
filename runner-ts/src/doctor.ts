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
import { mkdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { delimiter, isAbsolute, join, resolve } from "node:path";
import type { ReadyDef, ServiceDef, TestDef, TestfileDoc } from "./model.js";

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
  // Where a bare command name resolves on PATH, or undefined.
  onPath(command: string): string | undefined;
  // Whether that absolute path is a file this user can execute.
  executableAt(path: string): boolean;
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
  onPath(command) {
    const entries = (process.env.PATH ?? "").split(delimiter).filter(Boolean);
    // Windows decides by extension, and only PATHEXT ones are executable.
    const suffixes =
      process.platform === "win32"
        ? ["", ...(process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean)]
        : [""];
    for (const entry of entries) {
      for (const suffix of suffixes) {
        const candidate = join(entry, `${command}${suffix}`);
        if (realEnv.executableAt(candidate)) return candidate;
      }
    }
    return undefined;
  },
  executableAt(path) {
    try {
      const stats = statSync(path);
      if (!stats.isFile()) return false;
      // on Windows the extension decides, and PATHEXT already did the filtering
      return process.platform === "win32" || (stats.mode & 0o111) !== 0;
    } catch {
      return false;
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

// Shell builtins and keywords: the shell runs them itself, so looking for a
// file of that name says nothing.
const SHELL_WORDS = new Set([
  ":",
  ".",
  "[",
  "[[",
  "alias",
  "bg",
  "break",
  "builtin",
  "case",
  "cd",
  "command",
  "continue",
  "declare",
  "do",
  "done",
  "echo",
  "elif",
  "else",
  "esac",
  "eval",
  "exec",
  "exit",
  "export",
  "false",
  "fg",
  "fi",
  "for",
  "function",
  "getopts",
  "hash",
  "if",
  "in",
  "jobs",
  "kill",
  "let",
  "local",
  "printf",
  "pwd",
  "read",
  "readonly",
  "return",
  "set",
  "shift",
  "source",
  "test",
  "then",
  "time",
  "times",
  "trap",
  "true",
  "type",
  "ulimit",
  "umask",
  "unalias",
  "unset",
  "until",
  "wait",
  "while",
]);

// One executable a Testfile expects, and where it was asked for.
export interface CommandUse {
  // As written: "npm", "./scripts/build.sh", "/usr/local/bin/tool".
  token: string;
  // Directory a relative path resolves against.
  dir: string;
  // Test or service path, for the message.
  where: string;
}

// The executables a shell line starts with. Not a shell parser: it splits on
// the operators that begin a new command and takes the first word of each
// part, which is what a `command:` looks like in practice.
export function commandTokens(line: string): string[] {
  const tokens: string[] = [];
  for (const part of line.split(/\|\||&&|[;|&\n]/)) {
    let words = part
      .trim()
      .replace(/^[({]\s*/, "")
      .split(/\s+/)
      .filter(Boolean);
    // "FOO=bar cmd" runs cmd with FOO set
    while (words.length > 0 && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[0])) words = words.slice(1);
    const token = words[0];
    if (!token || SHELL_WORDS.has(token)) continue;
    // "${{ ... }}", "$VAR", "$(...)" and quoted words are only known at run time
    if (/[$`"'*?]/.test(token)) continue;
    tokens.push(token);
  }
  return tokens;
}

// Anything with a separator names a file, not something to look up on PATH.
function isPathLike(token: string): boolean {
  return token.includes("/") || token.includes("\\");
}

function readyExec(ready: ReadyDef | undefined): string | undefined {
  if (!ready?.exec) return undefined;
  return typeof ready.exec === "string" ? ready.exec : ready.exec.command;
}

// Every executable the Testfile names, with the directory a relative path
// resolves against. Bodies that run inside a container are left out - their
// commands live in the image, not on this machine - and `script:` blocks are
// shell programs rather than a command, so they are not guessed at either.
export function commandsUsed(doc: TestfileDoc, baseDir: string): CommandUse[] {
  const uses: CommandUse[] = [];
  const add = (line: string | undefined, dir: string, where: string): void => {
    for (const token of commandTokens(line ?? "")) uses.push({ token, dir, where });
  };
  const serviceUses = (services: Record<string, ServiceDef> | undefined, dir: string): void => {
    for (const [name, service] of Object.entries(services ?? {})) {
      const where = `service ${name}`;
      const serviceDir = service.workdir ? resolve(dir, service.workdir) : dir;
      if (!service.container) add(service.command, serviceDir, where);
      // the readiness probe runs on the host even for a container service
      add(readyExec(service.ready), serviceDir, where);
      add(service.stop?.command, serviceDir, where);
    }
  };

  serviceUses(doc.services, baseDir);

  const walk = (test: TestDef, dir: string, path: string, inContainer: boolean): void => {
    const here = test.workdir ? resolve(dir, test.workdir) : dir;
    const name = test.name ?? "test";
    const where = path ? `${path}/${name}` : name;
    const contained = inContainer || test.container !== undefined;
    serviceUses(test.services, here);
    // A custom `shell:` interprets the line its own way - a PowerShell cmdlet
    // is no file on PATH - so only the default sh commands are looked up.
    if (!contained && !test.shell) {
      add(test.command, here, where);
      add(test.setup?.command, here, where);
      add(test.teardown?.command, here, where);
    }
    for (const child of [...(test.sequence ?? []), ...(test.parallel ?? [])]) {
      walk(child, here, where, contained);
    }
    if (test.template) walk(test.template, here, where, contained);
  };
  if (doc.test) walk(doc.test, baseDir, "", false);

  // One entry per executable, listing every place it is used. A bare name is
  // looked up on PATH, so the directory only distinguishes path-like tokens.
  const seen = new Map<string, CommandUse>();
  for (const use of uses) {
    const key = isPathLike(use.token) ? `${use.token}\0${use.dir}` : use.token;
    const known = seen.get(key);
    if (known) {
      if (!known.where.split(", ").includes(use.where)) known.where += `, ${use.where}`;
    } else {
      seen.set(key, { ...use });
    }
  }
  return [...seen.values()].sort((a, b) => a.token.localeCompare(b.token));
}

function commandChecks(env: DoctorEnv, doc: TestfileDoc | undefined, baseDir: string): Check[] {
  if (!doc) return [];
  const uses = commandsUsed(doc, baseDir);
  if (uses.length === 0) {
    return [{ name: "commands", status: "ok", detail: "no plain commands to look up" }];
  }
  return uses.map(({ token, dir, where }) => {
    const name = `command (${token})`;
    if (isPathLike(token)) {
      const path = isAbsolute(token) ? token : resolve(dir, token);
      return env.executableAt(path)
        ? { name, status: "ok" as const, detail: path }
        : {
            name,
            status: "fail" as const,
            detail: `${path} is missing or not executable`,
            hint: `used by ${where} - check the path, or chmod +x it`,
          };
    }
    const found = env.onPath(token);
    return found
      ? { name, status: "ok" as const, detail: found }
      : {
          name,
          status: "fail" as const,
          detail: "not found on PATH",
          hint: `used by ${where} - install it, or use a path to it`,
        };
  });
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
    ...commandChecks(env, doc, baseDir),
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
