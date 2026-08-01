import { existsSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { Ajv2020, type ValidateFunction } from "ajv/dist/2020.js";
import { parse } from "yaml";
import type { TestDef, TestfileDoc } from "./model.js";
import { defaultName } from "./runtree.js";

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

  const visit = (def: TestDef, path: string, inParallel: boolean): void => {
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
            errors.push(`${path}/${childName}: needs ambiguous sibling "${needed}" (name appears more than once)`);
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

export function loadTestfile(pathOrDir: string): { path: string; doc: TestfileDoc } {
  const path = findTestfile(pathOrDir);
  const doc: unknown = parse(readFileSync(path, "utf8"));
  validateDoc(doc);
  validateSemantics(doc);
  return { path, doc };
}
