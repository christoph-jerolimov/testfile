import type { EnvMap } from "./model.js";

// Template scopes usable as ${{ scope.name }} in any string value.
export interface Scopes {
  env: Record<string, string>;
  ports: Record<string, number>;
  matrix: Record<string, string>;
}

const TEMPLATE_RE = /\$\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_-]*)\s*\}\}/g;

export function resolveTemplate(value: string, scopes: Scopes, where: string): string {
  return value.replace(TEMPLATE_RE, (_all, scope: string, name: string) => {
    if (scope !== "env" && scope !== "ports" && scope !== "matrix") {
      throw new Error(`${where}: unknown template scope "${scope}" in "${value}"`);
    }
    const bucket: Record<string, string | number> = scopes[scope];
    if (!(name in bucket)) {
      throw new Error(`${where}: "${scope}.${name}" is not defined (in "${value}")`);
    }
    return String(bucket[name]);
  });
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
