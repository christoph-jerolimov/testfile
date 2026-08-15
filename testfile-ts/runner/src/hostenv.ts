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
  // Session runtime dir: rootless container engines (podman) and other
  // tools locate their sockets through it.
  "XDG_RUNTIME_DIR",
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

// Two prefixes let whoever runs the suite hand variables to it without
// editing the Testfile or naming them in forwardEnv: TESTFILE_ENV_BASE_URL
// arrives as BASE_URL, and TESTFILE_SECRET_TOKEN arrives as TOKEN with its
// value masked in everything the run records. The prefix is a namespace on
// the host side only - it is stripped on the way in.
export const ENV_PREFIX = "TESTFILE_ENV_";
export const SECRET_PREFIX = "TESTFILE_SECRET_";

export interface PrefixedEnv {
  // The variables, under their names without the prefix.
  env: Record<string, string>;
  // Values to mask in recorded output. Never the empty string, which would
  // match between every pair of characters.
  secretValues: string[];
  // The names behind them, split by prefix - what a run records to explain
  // where a variable came from without disclosing what it held.
  names: { variables: string[]; secrets: string[] };
}

export function prefixedEnv(host: NodeJS.ProcessEnv = process.env): PrefixedEnv {
  const env: Record<string, string> = {};
  const secretValues: string[] = [];
  const names = { variables: [] as string[], secrets: [] as string[] };
  const take = (prefix: string, secret: boolean): void => {
    for (const [key, value] of Object.entries(host).sort(([a], [b]) => a.localeCompare(b))) {
      if (value === undefined || !key.startsWith(prefix)) continue;
      const name = key.slice(prefix.length);
      if (name === "") continue; // the bare prefix names nothing
      env[name] = value;
      (secret ? names.secrets : names.variables).push(name);
      if (secret && value !== "") secretValues.push(value);
    }
  };
  take(ENV_PREFIX, false);
  // Secrets last: a name given under both prefixes is the masked one.
  take(SECRET_PREFIX, true);
  return { env, secretValues, names };
}

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
  host: NodeJS.ProcessEnv = process.env,
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
// defaults, everything the given patterns forward, and the TESTFILE_ENV_ /
// TESTFILE_SECRET_ variables - in that order, so the more deliberate the
// mention of a variable, the later it lands and the more it wins.
export function baseEnv(
  forwardPatterns: readonly string[] | undefined,
  host: NodeJS.ProcessEnv = process.env,
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
  Object.assign(out, prefixedEnv(host).env);
  return out;
}
