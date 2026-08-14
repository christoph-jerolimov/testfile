// Overriding the document from the environment: a host variable named
// TESTFILE_CONFIG_<path> replaces a value in the loaded Testfile, so a run
// can be redirected without editing the file - another image, a different
// port, one command swapped out for a smoke-test variant.
//
//   TESTFILE_CONFIG_ports__db=15432
//   TESTFILE_CONFIG_services__postgres__container__image=postgres:17
//   TESTFILE_CONFIG_test__sequence__0__command='npm run test:unit -- --bail'
//
// `__` separates the path segments, because a single `_` is a legitimate
// character inside the keys themselves. Segments address map keys and array
// indices; the last one is what gets written.
import { parse } from "yaml";

export const CONFIG_PREFIX = "TESTFILE_CONFIG_";
export const PATH_SEPARATOR = "__";

export interface ConfigOverride {
  // The host variable, for error messages that can be acted on.
  source: string;
  segments: string[];
  value: unknown;
}

// Env values are strings, and most of the document is strings too - so a
// value stays exactly what it is unless it announces otherwise: an explicit
// list, map or quoted scalar, or a bare literal that can only be a number,
// a boolean or null. `postgres:17`, `1.20.3` and `0755` are left alone.
export function parseOverrideValue(raw: string): unknown {
  const trimmed = raw.trim();
  if (/^[[{"']/.test(trimmed)) {
    try {
      return parse(trimmed);
    } catch (err) {
      throw new Error(
        `value starts with ${trimmed[0]} but is not valid YAML: ${
          err instanceof Error ? err.message : err
        }`,
      );
    }
  }
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (trimmed === "null" || trimmed === "~") return null;
  // No leading zeros: a padded number is an identifier, not a quantity.
  if (/^-?(0|[1-9]\d*)$/.test(trimmed)) return Number(trimmed);
  if (/^-?(0|[1-9]\d*)\.\d+$/.test(trimmed)) return Number(trimmed);
  return raw;
}

// The overrides a host environment carries, in a deterministic order so two
// runs of the same environment apply them the same way.
export function collectConfigOverrides(host: NodeJS.ProcessEnv = process.env): ConfigOverride[] {
  const out: ConfigOverride[] = [];
  for (const key of Object.keys(host).sort()) {
    if (!key.startsWith(CONFIG_PREFIX)) continue;
    const value = host[key];
    if (value === undefined) continue;
    const segments = key.slice(CONFIG_PREFIX.length).split(PATH_SEPARATOR);
    if (segments.length === 0 || segments.some((segment) => segment === "")) {
      throw new Error(`${key}: not a path - expected TESTFILE_CONFIG_<key>${PATH_SEPARATOR}<key>`);
    }
    out.push({ source: key, segments, value: wrap(key, () => parseOverrideValue(value)) });
  }
  return out;
}

function wrap<T>(source: string, run: () => T): T {
  try {
    return run();
  } catch (err) {
    throw new Error(`${source}: ${err instanceof Error ? err.message : err}`);
  }
}

// An environment variable name cannot hold a `-`, and Windows upper-cases
// the name on the way in - so a segment matches its key exactly, or
// case-insensitively, or with `_` standing in for `-`.
function findKey(node: Record<string, unknown>, segment: string): string | undefined {
  if (Object.hasOwn(node, segment)) return segment;
  const keys = Object.keys(node);
  const lower = segment.toLowerCase();
  const loose = (value: string): string => value.toLowerCase().replace(/-/g, "_");
  return (
    keys.find((key) => key.toLowerCase() === lower) ??
    keys.find((key) => loose(key) === loose(segment))
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Walks one segment, creating a map on the way when the path does not exist
// yet - so an override can add an `env` block a test never had. Arrays are
// only indexed, never grown: what a new element would mean is anyone's
// guess, and a silent no-op would be worse.
function step(node: unknown, segment: string, walked: string[], source: string): unknown {
  const where = walked.length > 0 ? walked.join(".") : "the document";
  if (Array.isArray(node)) {
    if (!/^\d+$/.test(segment)) {
      throw new Error(`${source}: ${where} is a list, so "${segment}" must be an index`);
    }
    const index = Number(segment);
    if (index >= node.length) {
      throw new Error(
        `${source}: ${where} has ${node.length} entries, so index ${index} is out of range`,
      );
    }
    return node[index];
  }
  if (!isRecord(node)) {
    throw new Error(`${source}: ${where} is a value, so nothing can be set inside it`);
  }
  const key = findKey(node, segment);
  if (key === undefined) {
    node[segment] = {};
    return node[segment];
  }
  return node[key];
}

function write(
  node: unknown,
  segment: string,
  value: unknown,
  walked: string[],
  source: string,
): void {
  const where = walked.length > 0 ? walked.join(".") : "the document";
  if (Array.isArray(node)) {
    if (!/^\d+$/.test(segment)) {
      throw new Error(`${source}: ${where} is a list, so "${segment}" must be an index`);
    }
    const index = Number(segment);
    if (index >= node.length) {
      throw new Error(
        `${source}: ${where} has ${node.length} entries, so index ${index} is out of range`,
      );
    }
    node[index] = value;
    return;
  }
  if (!isRecord(node)) {
    throw new Error(`${source}: ${where} is a value, so nothing can be set inside it`);
  }
  node[findKey(node, segment) ?? segment] = value;
}

// Applies every override to the document in place and returns the paths
// that were written, for the runner to report. The document is validated
// again afterwards by the caller, so an override that breaks it fails the
// run rather than corrupting it.
export function applyConfigOverrides(
  doc: unknown,
  host: NodeJS.ProcessEnv = process.env,
): string[] {
  const applied: string[] = [];
  for (const override of collectConfigOverrides(host)) {
    const { segments, source, value } = override;
    let node: unknown = doc;
    const walked: string[] = [];
    for (const segment of segments.slice(0, -1)) {
      node = step(node, segment, walked, source);
      walked.push(segment);
    }
    write(node, segments[segments.length - 1], value, walked, source);
    applied.push(segments.join("."));
  }
  return applied;
}
