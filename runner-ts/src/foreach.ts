import { globSync, statSync } from "node:fs";
import { basename, dirname, relative, resolve, sep } from "node:path";
import { matchesPathPattern } from "./gitchanges.js";
import type { ForeachDef, TestDef } from "./model.js";

// `foreach` generates one test per matching folder (or file) from a
// template - the counterpart of `include` for projects that have no
// per-package Testfile, and of `matrix` for variation that comes from the
// file system instead of a list of values:
//
//   - name: packages
//     foreach: packages/*
//     template:
//       name: ${{ each.name }}
//       workdir: ${{ each.path }}
//       sequence:
//         - name: build
//           command: npm run build
//         - name: test
//           command: npm test
//
// The generated tests become a parallel group, like a glob `include`.

export interface EachValues {
  // Path relative to the Testfile's directory, "/"-separated.
  path: string;
  // Last segment, e.g. "api" for packages/api.
  name: string;
  // Parent directory relative to the Testfile ("packages"), "." at the top.
  dir: string;
  absolute: string;
}

function normalize(def: ForeachDef | string): ForeachDef {
  return typeof def === "string" ? { glob: def } : def;
}

// The matches of one foreach declaration, alphabetically ordered.
export function matchPaths(def: ForeachDef | string, baseDir: string): EachValues[] {
  const spec = normalize(def);
  const wantFolders = spec.folder ?? true;
  const wantFiles = spec.file ?? false;
  if (!wantFolders && !wantFiles) {
    throw new Error(`foreach "${spec.glob}": folder and file are both false, nothing can match`);
  }

  const matches = globSync(spec.glob, { cwd: baseDir })
    .map((match) => match.split(sep).join("/"))
    .filter((path) => path !== "" && path !== ".")
    .sort((a, b) => a.localeCompare(b));

  const out: EachValues[] = [];
  const seen = new Set<string>();
  for (const path of matches) {
    if (seen.has(path)) continue;
    seen.add(path);
    if ((spec.ignore ?? []).some((pattern) => matchesPathPattern(path, pattern))) continue;
    const absolute = resolve(baseDir, path);
    let isDirectory: boolean;
    try {
      isDirectory = statSync(absolute).isDirectory();
    } catch {
      continue; // vanished between glob and stat
    }
    if (isDirectory ? !wantFolders : !wantFiles) continue;
    const parent = relative(baseDir, dirname(absolute)).split(sep).join("/");
    out.push({ path, name: basename(path), dir: parent === "" ? "." : parent, absolute });
  }
  return out;
}

// Replaces ${{ each.* }} in every string of a cloned template. Other
// templates (env, ports, matrix) are left untouched - they are resolved
// later, at run time.
export function applyEach<T>(template: T, values: EachValues): T {
  const substitute = (text: string): string =>
    text.replace(/\$\{\{\s*each\.(\w+)\s*\}\}/g, (_match, key: string) => {
      const value = (values as unknown as Record<string, string>)[key];
      if (value === undefined) {
        throw new Error(`unknown reference "each.${key}" (known: path, name, dir, absolute)`);
      }
      return value;
    });

  const walk = (node: unknown): unknown => {
    if (typeof node === "string") return substitute(node);
    if (Array.isArray(node)) return node.map(walk);
    if (node && typeof node === "object") {
      const out: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(node)) out[substitute(key)] = walk(value);
      return out;
    }
    return node;
  };
  return walk(template) as T;
}

// Turns a test carrying `foreach` + `template` into a parallel group of
// generated tests. Returns the generated children so the caller can keep
// expanding them (a generated test may itself include or foreach).
export function expandForeach(def: TestDef, baseDir: string): TestDef[] {
  const spec = normalize(def.foreach!);
  const where = `foreach "${spec.glob}"`;
  if (!def.template) throw new Error(`${where}: needs a "template" test`);
  if (def.command !== undefined || def.script !== undefined) {
    throw new Error(`${where}: cannot be combined with command/script - put them in the template`);
  }
  if (def.sequence !== undefined || def.parallel !== undefined) {
    throw new Error(`${where}: cannot be combined with sequence/parallel`);
  }

  const matches = matchPaths(spec, baseDir);
  if (matches.length === 0) {
    throw new Error(
      `${where}: matched nothing in ${baseDir}` +
        ((spec.ignore ?? []).length > 0 ? " (after applying ignore)" : "")
    );
  }

  const children = matches.map((values) => {
    const child = applyEach(def.template!, values);
    // A template without its own name is named after the match.
    return { ...child, name: child.name ?? values.name };
  });

  delete def.foreach;
  delete def.template;
  def.name = def.name ?? spec.glob;
  def.parallel = children;
  return children;
}
