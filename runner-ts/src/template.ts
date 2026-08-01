import type { EnvMap } from "./model.js";

// Template scopes usable as ${{ scope.name }} in any string value.
export interface Scopes {
  env: Record<string, string>;
  ports: Record<string, number>;
  matrix: Record<string, string>;
}

const TEMPLATE_RE =
  /\$\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_-]*)\s*(?:\|\|\s*([^}]*?))?\s*\}\}/g;

// With lenient: true, unknown references resolve to "" instead of throwing —
// used for `if` conditions, where e.g. env.CI is legitimately unset locally.
// A `|| default` inside the template supplies a fallback when the reference
// is undefined or empty, e.g. ${{ env.PORT || 3000 }}.
export function resolveTemplate(
  value: string,
  scopes: Scopes,
  where: string,
  options: { lenient?: boolean } = {}
): string {
  return value.replace(TEMPLATE_RE, (_all, scope: string, name: string, fallback?: string) => {
    const defaultValue = fallback !== undefined ? unquote(fallback.trim()) : undefined;
    if (scope !== "env" && scope !== "ports" && scope !== "matrix") {
      if (options.lenient) return defaultValue ?? "";
      throw new Error(`${where}: unknown template scope "${scope}" in "${value}"`);
    }
    const bucket: Record<string, string | number> = scopes[scope];
    const resolved = name in bucket ? String(bucket[name]) : undefined;
    if (resolved !== undefined && resolved !== "") return resolved;
    if (defaultValue !== undefined) return defaultValue;
    if (resolved !== undefined) return resolved; // defined but empty, no default
    if (options.lenient) return "";
    throw new Error(`${where}: "${scope}.${name}" is not defined (in "${value}")`);
  });
}

function unquote(value: string): string {
  const match = /^"(.*)"$/s.exec(value) ?? /^'(.*)'$/s.exec(value);
  return match ? match[1] : value;
}

// Resolves an env map's values against the given scopes. Values reference the
// *parent* environment, not their siblings.
export function resolveEnvMap(map: EnvMap | undefined, scopes: Scopes, where: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(map ?? {})) {
    out[key] = resolveTemplate(String(value), scopes, `${where}.env.${key}`);
  }
  return out;
}
