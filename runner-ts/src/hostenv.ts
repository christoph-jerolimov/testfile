// The environment tests and services run in. Host environment variables do
// NOT leak into tests: only a small essential allowlist (paths, locale,
// temp dirs) is passed through, plus whatever `forwardEnv` patterns
// explicitly forward. The runner itself provides CI=1 and forces color
// output, so tools behave the same on every machine.

// Variables commands can hardly run without. Windows names are included so
// the list works cross-platform; missing ones are simply skipped.
export const ESSENTIAL_HOST_ENV = [
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "SHELL",
  "TMPDIR",
  "TMP",
  "TEMP",
  "LANG",
  "TZ",
  "SYSTEMROOT",
  "COMSPEC",
  "PATHEXT",
  "USERPROFILE",
  "APPDATA",
  "LOCALAPPDATA",
];

// Values the runner provides by default; doc/test env and forwarded
// variables can override them.
export const RUNNER_ENV: Record<string, string> = {
  CI: "1",
  FORCE_COLOR: "1",
  CLICOLOR_FORCE: "1",
};

// Simple glob matching for variable names: * matches any run of
// characters, everything else is literal. "GITHUB_*" or just "*".
export function matchesEnvPattern(name: string, pattern: string): boolean {
  if (pattern === "*") return true;
  const re = pattern
    .split("*")
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${re}$`).test(name);
}

// The host variables matched by any of the given patterns.
export function forwardedEnv(
  patterns: readonly string[] | undefined,
  host: NodeJS.ProcessEnv = process.env
): Record<string, string> {
  const out: Record<string, string> = {};
  if (!patterns || patterns.length === 0) return out;
  for (const [key, value] of Object.entries(host)) {
    if (value === undefined) continue;
    if (patterns.some((pattern) => matchesEnvPattern(key, pattern))) out[key] = value;
  }
  return out;
}

// The clean base environment: essentials from the host, the runner's
// defaults, and everything the given patterns forward (in that order, so
// forwarded variables win over the defaults).
export function baseEnv(
  forwardPatterns: readonly string[] | undefined,
  host: NodeJS.ProcessEnv = process.env
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of ESSENTIAL_HOST_ENV) {
    const value = host[key];
    if (value !== undefined) out[key] = value;
  }
  for (const [key, value] of Object.entries(host)) {
    if (key.startsWith("LC_") && value !== undefined) out[key] = value;
  }
  Object.assign(out, RUNNER_ENV);
  Object.assign(out, forwardedEnv(forwardPatterns, host));
  return out;
}
