import { existsSync, globSync, readFileSync, realpathSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { Ajv2020, type ValidateFunction } from "ajv/dist/2020.js";
import { parse } from "yaml";
import { expandForeach } from "./foreach.js";
import type { ServiceDef, TestDef, TestfileDoc } from "./model.js";
import { defaultName } from "./runsuite.js";

const require = createRequire(import.meta.url);

export const TESTFILE_NAMES = ["Testfile", "testfile.yaml", "testfile.yml"];

export function findTestfile(pathOrDir: string): string {
  const p = resolve(pathOrDir);
  if (!existsSync(p)) throw new Error(`${p} does not exist`);
  if (statSync(p).isFile()) return p;
  for (const name of TESTFILE_NAMES) {
    const candidate = join(p, name);
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(`no Testfile found in ${p} (looked for ${TESTFILE_NAMES.join(", ")})`);
}

let compiled: ValidateFunction | undefined;

function validator(): ValidateFunction {
  if (!compiled) {
    const schema = require("@testfile/schema");
    // Same Ajv options as schema/scripts/validate.mjs.
    const ajv = new Ajv2020({ allErrors: true, allowUnionTypes: true, strictRequired: false });
    compiled = ajv.compile(schema);
  }
  return compiled;
}

export function validateDoc(doc: unknown): asserts doc is TestfileDoc {
  const validate = validator();
  if (!validate(doc)) {
    const messages = (validate.errors ?? []).map((e) => `  ${e.instancePath || "/"} ${e.message}`);
    throw new Error(`Testfile is not valid:\n${messages.join("\n")}`);
  }
}

// Rules the JSON schema cannot express: `needs` context and references.
export function validateSemantics(doc: TestfileDoc): void {
  const errors: string[] = [];

  // `needs` between services in one map: names must exist in that map and
  // must not form a cycle (nothing would ever start).
  const checkServices = (services: Record<string, ServiceDef> | undefined, where: string): void => {
    const entries = Object.entries(services ?? {});
    if (entries.length === 0) return;
    const byName = new Map(entries);
    for (const [name, def] of entries) {
      for (const needed of def.needs ?? []) {
        if (needed === name) {
          errors.push(`${where}: service "${name}" cannot need itself`);
        } else if (!byName.has(needed)) {
          errors.push(`${where}: service "${name}" needs unknown service "${needed}"`);
        }
      }
    }
    const state = new Map<string, "visiting" | "done">();
    const dfs = (name: string, trail: string[]): void => {
      const status = state.get(name);
      if (status === "done") return;
      if (status === "visiting") {
        errors.push(`${where}: cyclic service needs (${[...trail, name].join(" -> ")})`);
        return;
      }
      state.set(name, "visiting");
      for (const needed of byName.get(name)?.needs ?? []) {
        if (byName.has(needed) && needed !== name) dfs(needed, [...trail, name]);
      }
      state.set(name, "done");
    };
    for (const [name] of entries) dfs(name, []);
  };
  checkServices(doc.services, "Testfile services");

  const visit = (def: TestDef, path: string, inParallel: boolean): void => {
    checkServices(def.services, `${path} services`);
    if (def.include !== undefined) {
      errors.push(
        `${path}: unresolved include - includes are expanded when loading a Testfile from disk`,
      );
    }
    if (def.foreach !== undefined) {
      errors.push(
        `${path}: unresolved foreach - foreach is expanded when loading a Testfile from disk`,
      );
    }
    if (def.needs?.length && !inParallel) {
      errors.push(`${path}: "needs" is only allowed on children of a parallel group`);
    }
    const children = def.sequence ?? def.parallel ?? [];
    if (def.parallel) {
      const counts = new Map<string, number>();
      for (const child of children) {
        const name = defaultName(child);
        counts.set(name, (counts.get(name) ?? 0) + 1);
      }
      for (const child of children) {
        const childName = defaultName(child);
        for (const needed of child.needs ?? []) {
          if (needed === childName) {
            errors.push(`${path}/${childName}: cannot need itself`);
          } else if (!counts.has(needed)) {
            errors.push(`${path}/${childName}: needs unknown sibling "${needed}"`);
          } else if (counts.get(needed)! > 1) {
            errors.push(
              `${path}/${childName}: needs ambiguous sibling "${needed}" (name appears more than once)`,
            );
          }
        }
      }
      // cycle detection via DFS over the sibling graph
      const byName = new Map(children.map((child) => [defaultName(child), child]));
      const state = new Map<TestDef, "visiting" | "done">();
      const dfs = (child: TestDef, trail: string[]): void => {
        const status = state.get(child);
        if (status === "done") return;
        if (status === "visiting") {
          errors.push(`${path}: cyclic needs (${[...trail, defaultName(child)].join(" -> ")})`);
          return;
        }
        state.set(child, "visiting");
        for (const needed of child.needs ?? []) {
          const target = byName.get(needed);
          if (target && counts.get(needed) === 1) dfs(target, [...trail, defaultName(child)]);
        }
        state.set(child, "done");
      };
      for (const child of children) dfs(child, []);
    }
    for (const child of children) {
      visit(child, `${path}/${defaultName(child)}`, def.parallel !== undefined);
    }
  };

  visit(doc.test, defaultName(doc.test), false);
  if (errors.length > 0) {
    throw new Error(`Testfile is not valid:\n${errors.map((e) => `  ${e}`).join("\n")}`);
  }
}

// Replaces every `include` test with the content of the referenced
// Testfile(s): their root test is embedded as a nested suite, their env and
// services become test-scoped, their ports merge into the root document's
// ports, and their directory becomes the embedded tests' working directory.
export function expandIncludes(doc: TestfileDoc, filePath: string): void {
  const real = realpathSync(resolve(filePath));
  expandTest(doc, doc.test, dirname(real), [real]);
}

function expandTest(root: TestfileDoc, def: TestDef, baseDir: string, stack: string[]): void {
  // `foreach` first: it generates tests that may themselves include or
  // contain another foreach.
  if (def.foreach !== undefined) {
    expandForeach(def, baseDir);
  }
  if (def.include !== undefined) {
    const pattern = def.include;
    const where = `include "${pattern}"`;
    if (def.workdir !== undefined) {
      throw new Error(
        `${where}: "workdir" cannot be combined with include (the included file's directory is used)`,
      );
    }
    const matches = /[*?[\]{}]/.test(pattern)
      ? globSync(pattern, { cwd: baseDir })
          .sort()
          .map((m) => join(baseDir, m))
      : [resolve(baseDir, pattern)];
    if (matches.length === 0) throw new Error(`${where}: nothing matched`);
    const embeds = matches.map((match) => embedFile(root, match, stack, where));
    delete def.include;
    if (embeds.length === 1) {
      const embed = embeds[0];
      def.name = def.name ?? embed.name;
      def.env = { ...embed.env, ...def.env };
      if (embed.services || def.services) def.services = { ...embed.services, ...def.services };
      def.workdir = embed.workdir;
      def.sequence = embed.sequence;
    } else {
      def.name = def.name ?? pattern;
      def.parallel = embeds;
    }
    return;
  }
  for (const child of def.sequence ?? def.parallel ?? []) {
    expandTest(root, child, baseDir, stack);
  }
}

function embedFile(root: TestfileDoc, pathOrDir: string, stack: string[], where: string): TestDef {
  let file: string;
  try {
    file = findTestfile(pathOrDir);
  } catch (err) {
    throw new Error(`${where}: ${err instanceof Error ? err.message : err}`);
  }
  const real = realpathSync(file);
  if (stack.includes(real)) {
    throw new Error(`${where}: include cycle (${[...stack, real].join(" -> ")})`);
  }
  const raw: unknown = parse(readFileSync(file, "utf8"));
  try {
    validateDoc(raw);
  } catch (err) {
    throw new Error(`${where}: ${err instanceof Error ? err.message : err}`);
  }
  const included = raw;
  expandTest(root, included.test, dirname(real), [...stack, real]);
  for (const [name, value] of Object.entries(included.ports ?? {})) {
    const existing = root.ports?.[name];
    if (existing !== undefined && existing !== value) {
      throw new Error(
        `${where}: port "${name}" (${value}) conflicts with an existing port (${existing})`,
      );
    }
    root.ports = { ...root.ports, [name]: value };
  }
  return {
    name: included.name ?? file,
    env: included.env,
    services: included.services,
    workdir: dirname(real),
    sequence: [included.test],
  };
}

export function loadTestfile(pathOrDir: string): { path: string; doc: TestfileDoc } {
  const path = findTestfile(pathOrDir);
  const doc: unknown = parse(readFileSync(path, "utf8"));
  validateDoc(doc);
  expandIncludes(doc, path);
  validateSemantics(doc);
  return { path, doc };
}
