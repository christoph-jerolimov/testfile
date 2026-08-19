import { existsSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

export function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m${Math.round((ms % 60_000) / 1000)}s`;
}

const useColor = process.stdout.isTTY && !process.env.NO_COLOR;

export function color(code: number, text: string): string {
  return useColor ? `\u001b[${code}m${text}\u001b[0m` : text;
}

export function stripAnsi(text: string): string {
  return text.replace(/\u001b\[[0-9;]*m/g, "");
}

export function pad(text: string, width: number): string {
  return text + " ".repeat(Math.max(0, width - stripAnsi(text).length));
}

// The helpers every command line over this domain shares - the cli's
// history commands, and the commands the sync and mcp packages bring
// along. They live here because core is the one package all of those
// already read.

// Everything works directly on the .testfile folder; a path may point at a
// Testfile, its directory, or any directory containing .testfile/.
export function resolveHistoryBase(path: string): string {
  const p = resolve(path);
  return existsSync(p) && statSync(p).isFile() ? dirname(p) : p;
}

export function commandFailed(err: unknown): void {
  console.error(`${color(31, "✘")} ${err instanceof Error ? err.message : err}`);
  process.exitCode = 1;
}

// `--json` without a value is `true`; absent is `undefined` or `false`.
export function wantsJson(value: string | boolean | undefined): value is string | true {
  return value !== undefined && value !== false;
}

export function writeJson(data: unknown, target: string | true): void {
  const json = `${JSON.stringify(data, null, 2)}\n`;
  if (typeof target === "string") {
    writeFileSync(target, json);
    console.log(color(90, `written to ${target}`));
  } else {
    process.stdout.write(json);
  }
}
