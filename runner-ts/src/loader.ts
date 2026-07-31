import { existsSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { Ajv2020, type ValidateFunction } from "ajv/dist/2020.js";
import { parse } from "yaml";
import type { TestfileDoc } from "./model.js";

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

export function loadTestfile(pathOrDir: string): { path: string; doc: TestfileDoc } {
  const path = findTestfile(pathOrDir);
  const doc: unknown = parse(readFileSync(path, "utf8"));
  validateDoc(doc);
  return { path, doc };
}
