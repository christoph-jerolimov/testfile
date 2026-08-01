import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { resolveTemplate, type Scopes } from "./template.js";

// Parses dotenv-style content: KEY=VALUE lines, blank lines and #-comments,
// an optional "export " prefix, and single/double quoted values.
export function parseEnvFile(content: string, where: string): Record<string, string> {
  const out: Record<string, string> = {};
  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line === "" || line.startsWith("#")) continue;
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) {
      throw new Error(`${where}: line ${i + 1} is not a KEY=VALUE pair: "${line}"`);
    }
    let value = match[2].trim();
    const quoted = /^"(.*)"$/.exec(value) ?? /^'(.*)'$/.exec(value);
    if (quoted) value = quoted[1];
    else {
      const comment = value.indexOf(" #");
      if (comment >= 0) value = value.slice(0, comment).trim();
    }
    out[match[1]] = value;
  }
  return out;
}

// Loads one or more env files (relative to baseDir, in order, later files
// win), resolves ${{ ... }} templates in the values, and registers every
// value as a secret so it can be masked in persisted logs.
export function loadEnvFiles(
  spec: string | string[] | undefined,
  baseDir: string,
  scopes: Scopes,
  where: string,
  secrets: Set<string>
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const file of typeof spec === "string" ? [spec] : (spec ?? [])) {
    const path = resolve(baseDir, resolveTemplate(file, scopes, where));
    let content: string;
    try {
      content = readFileSync(path, "utf8");
    } catch {
      throw new Error(`${where}: cannot read env file ${path}`);
    }
    const parsed = parseEnvFile(content, `${where} (${file})`);
    for (const [key, rawValue] of Object.entries(parsed)) {
      const value = resolveTemplate(rawValue, scopes, `${where} (${file}) ${key}`);
      out[key] = value;
      secrets.add(value);
    }
  }
  return out;
}

// Replaces env-file values in a text with *** so they never end up in
// recorded logs. Very short values are left alone to avoid mangling output.
export function maskSecrets(text: string, secrets: readonly string[]): string {
  let masked = text;
  for (const secret of secrets) {
    if (secret.length >= 4) masked = masked.split(secret).join("***");
  }
  return masked;
}
