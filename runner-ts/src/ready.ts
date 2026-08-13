import { spawn } from "node:child_process";
import { connect } from "node:net";
import type { ReadyDef } from "./model.js";
import type { OutputBuffer } from "./output.js";
import { resolveTemplate, type Scopes } from "./template.js";
import { formatMs, parseDurationMs, sleep } from "./util.js";

// How long one exec attempt may take, wherever it runs. A probe that hangs
// must not hold up the poll loop; the next interval tries again.
export const EXEC_TIMEOUT_MS = 10_000;

export interface WaitReadyOptions {
  output: OutputBuffer;
  scopes: Scopes;
  signal: AbortSignal;
  where: string;
  // Working directory for exec checks that run on the host.
  cwd?: string;
  // Runs an exec check inside the service's own container, resolving to
  // whether it exited 0. Set only for container services; `exec.host: true`
  // bypasses it and uses the host shell.
  execInContainer?: (command: string) => Promise<boolean>;
  // Log checks only match lines appended at or after this index.
  logFrom?: number;
  // Lets the wait fail fast when the service process already exited.
  isRunning?: () => boolean;
}

// What a check says when it is the one holding the service back. Every
// configured check is retried each round, so a timeout is only ever caused
// by the checks that were still false in the last one - naming them saves
// the guesswork when a service combines two or three.
const STILL_FAILING = {
  http: "http did not answer",
  tcp: "tcp connect failed",
  log: "log pattern not seen",
  exec: "exec did not exit 0",
} as const;

type CheckName = keyof typeof STILL_FAILING;

// Polls all configured checks until they all pass, the timeout expires, the
// service dies, or the run is aborted. All checks run concurrently in every
// round and must pass in the same one: a port that opened two rounds ago
// counts for nothing if it is closed again now.
export async function waitReady(def: ReadyDef | undefined, opts: WaitReadyOptions): Promise<void> {
  if (!def) return;
  const delay = parseDurationMs(def.delay, 0);
  const interval = parseDurationMs(def.interval, 1000);
  const timeout = parseDurationMs(def.timeout, 30_000);
  if (delay > 0) await sleep(delay, opts.signal);
  const deadline = Date.now() + timeout;

  for (;;) {
    if (opts.signal.aborted) throw new Error("aborted while waiting for readiness");
    if (opts.isRunning && !opts.isRunning()) throw new Error("exited before becoming ready");

    const checks: Array<[CheckName, Promise<boolean>]> = [];
    if (def.http !== undefined) checks.push(["http", checkHttp(def.http, opts)]);
    if (def.tcp !== undefined) checks.push(["tcp", checkTcp(def.tcp, opts)]);
    if (def.log !== undefined) checks.push(["log", Promise.resolve(checkLog(def.log, opts))]);
    if (def.exec !== undefined) checks.push(["exec", checkExec(def.exec, opts)]);
    const results = await Promise.all(checks.map(([, result]) => result));
    if (results.every(Boolean)) {
      opts.output.system("ready");
      return;
    }
    if (Date.now() >= deadline) {
      const failing = checks.filter((_, i) => !results[i]).map(([name]) => STILL_FAILING[name]);
      throw new Error(`not ready after ${formatMs(timeout)} (${failing.join(", ")})`);
    }
    await sleep(Math.min(interval, Math.max(1, deadline - Date.now())), opts.signal);
  }
}

async function checkHttp(
  def: NonNullable<ReadyDef["http"]>,
  opts: WaitReadyOptions,
): Promise<boolean> {
  const spec = typeof def === "string" ? { url: def } : def;
  const url = resolveTemplate(spec.url, opts.scopes, opts.where);
  try {
    const res = await fetch(url, {
      method: spec.method ?? "GET",
      signal: AbortSignal.timeout(5000),
    });
    return spec.status !== undefined ? res.status === spec.status : res.ok;
  } catch {
    return false;
  }
}

function checkTcp(def: NonNullable<ReadyDef["tcp"]>, opts: WaitReadyOptions): Promise<boolean> {
  const spec = typeof def === "object" ? def : { port: def };
  const host = spec.host ?? "localhost";
  const port = Number(
    typeof spec.port === "string" ? resolveTemplate(spec.port, opts.scopes, opts.where) : spec.port,
  );
  return new Promise((resolve) => {
    const socket = connect({ host, port });
    const done = (ok: boolean) => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(2000, () => done(false));
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
  });
}

// The probe a service ships with usually lives in its own image, not on the
// machine running the tests - so for a container service the command runs
// inside the container, and only `host: true` puts it back in a host shell.
function checkExec(def: NonNullable<ReadyDef["exec"]>, opts: WaitReadyOptions): Promise<boolean> {
  const spec = typeof def === "string" ? { command: def } : def;
  const command = resolveTemplate(spec.command, opts.scopes, opts.where);
  if (opts.execInContainer && spec.host !== true) {
    return opts.execInContainer(command).catch(() => false);
  }
  return new Promise((resolve) => {
    const child = spawn("sh", ["-c", command], {
      cwd: opts.cwd,
      env: opts.scopes.env,
      stdio: "ignore",
    });
    // One attempt must not hang the poll loop forever.
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve(false);
    }, EXEC_TIMEOUT_MS);
    child.once("error", () => {
      clearTimeout(timer);
      resolve(false);
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      resolve(code === 0);
    });
  });
}

function checkLog(def: NonNullable<ReadyDef["log"]>, opts: WaitReadyOptions): boolean {
  const spec = typeof def === "string" ? { pattern: def } : def;
  const stream = spec.stream === "stdout" || spec.stream === "stderr" ? spec.stream : undefined;
  return new RegExp(spec.pattern).test(opts.output.text(stream, opts.logFrom ?? 0));
}
