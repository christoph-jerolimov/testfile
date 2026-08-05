import { spawn } from "node:child_process";
import { connect } from "node:net";
import type { ReadyDef } from "./model.js";
import type { OutputBuffer } from "./output.js";
import { resolveTemplate, type Scopes } from "./template.js";
import { formatMs, parseDurationMs, sleep } from "./util.js";

export interface WaitReadyOptions {
  output: OutputBuffer;
  scopes: Scopes;
  signal: AbortSignal;
  where: string;
  // Working directory for exec checks.
  cwd?: string;
  // Log checks only match lines appended at or after this index.
  logFrom?: number;
  // Lets the wait fail fast when the service process already exited.
  isRunning?: () => boolean;
}

// Polls all configured checks until they all pass, the timeout expires, the
// service dies, or the run is aborted.
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

    const checks: Promise<boolean>[] = [];
    if (def.http !== undefined) checks.push(checkHttp(def.http, opts));
    if (def.tcp !== undefined) checks.push(checkTcp(def.tcp, opts));
    if (def.log !== undefined) checks.push(Promise.resolve(checkLog(def.log, opts)));
    if (def.exec !== undefined) checks.push(checkExec(def.exec, opts));
    const results = await Promise.all(checks);
    if (results.every(Boolean)) {
      opts.output.system("ready");
      return;
    }
    if (Date.now() >= deadline) {
      throw new Error(`not ready after ${formatMs(timeout)}`);
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

function checkExec(def: NonNullable<ReadyDef["exec"]>, opts: WaitReadyOptions): Promise<boolean> {
  const spec = typeof def === "string" ? { command: def } : def;
  const command = resolveTemplate(spec.command, opts.scopes, opts.where);
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
    }, 10_000);
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
