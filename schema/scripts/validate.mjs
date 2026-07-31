#!/usr/bin/env node
// Validates the JSON schema itself, all examples in tests/valid (must pass),
// all examples in tests/invalid (must fail), and the repository's own Testfile.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname, resolve, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { parse } from "yaml";

const schemaDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const schema = JSON.parse(readFileSync(join(schemaDir, "testfile.schema.json"), "utf8"));

// strictRequired is off: the schema intentionally uses the idiomatic
// oneOf/anyOf-with-required pattern to express "exactly/at least one of".
const ajv = new Ajv2020({ allErrors: true, strict: true, allowUnionTypes: true, strictRequired: false });
addFormats(ajv);
const validate = ajv.compile(schema);

let failures = 0;

function check(file, expectValid) {
  const doc = parse(readFileSync(file, "utf8"));
  const valid = validate(doc);
  const label = expectValid ? "valid" : "invalid";
  if (valid === expectValid) {
    console.log(`  ok      ${label}/${basename(file)}`);
  } else {
    failures++;
    console.error(`  FAILED  ${label}/${basename(file)} — expected ${label} but was ${valid ? "valid" : "invalid"}`);
    if (!valid) {
      for (const err of validate.errors ?? []) {
        console.error(`          ${err.instancePath || "/"} ${err.message}`);
      }
    }
  }
}

function checkDir(dir, expectValid) {
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"))
    .sort();
  if (files.length === 0) {
    failures++;
    console.error(`  FAILED  no examples found in ${dir}`);
  }
  for (const f of files) check(join(dir, f), expectValid);
}

console.log("Schema compiles: ok");
console.log("Valid examples (must pass):");
checkDir(join(schemaDir, "tests", "valid"), true);
console.log("Invalid examples (must be rejected):");
checkDir(join(schemaDir, "tests", "invalid"), false);

const rootTestfile = join(schemaDir, "..", "Testfile");
if (existsSync(rootTestfile)) {
  console.log("Repository Testfile:");
  check(rootTestfile, true);
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nAll schema checks passed");
