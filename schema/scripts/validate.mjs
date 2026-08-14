#!/usr/bin/env node
// Validates the JSON schema itself, all examples in tests/valid (must pass),
// all examples in tests/invalid (must fail), the repository's own Testfile,
// and every complete Testfile printed in the documentation.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname, resolve, basename, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { parse } from "yaml";

const schemaDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const schema = JSON.parse(readFileSync(join(schemaDir, "testfile.schema.json"), "utf8"));
const runSchema = JSON.parse(readFileSync(join(schemaDir, "testrun.schema.json"), "utf8"));

// strictRequired is off: the schema intentionally uses the idiomatic
// oneOf/anyOf-with-required pattern to express "exactly/at least one of".
const ajv = new Ajv2020({
  allErrors: true,
  strict: true,
  allowUnionTypes: true,
  strictRequired: false,
});
addFormats(ajv);
const validate = ajv.compile(schema);
const validateRun = ajv.compile(runSchema);

let failures = 0;

function check(file, expectValid, name = `${expectValid ? "valid" : "invalid"}/${basename(file)}`) {
  const doc = parse(readFileSync(file, "utf8"));
  const valid = validate(doc);
  const label = expectValid ? "valid" : "invalid";
  if (valid === expectValid) {
    console.log(`  ok      ${name}`);
  } else {
    failures++;
    console.error(`  FAILED  ${name} — expected ${label} but was ${valid ? "valid" : "invalid"}`);
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

// The examples gallery on the website renders these files; they must stay
// valid against the current schema, including the ones nested in the
// monorepo example.
const examplesDir = join(schemaDir, "..", "examples");
if (existsSync(examplesDir)) {
  console.log("Examples:");
  const found = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name === "Testfile") found.push(path);
    }
  };
  walk(examplesDir);
  if (found.length === 0) {
    failures++;
    console.error("  FAILED  no example Testfiles found");
  }
  for (const file of found) check(file, true, relative(join(schemaDir, ".."), file));
}

// The result format: every recorded run.yaml in tests/runs (and any run
// this repository recorded locally) must match testrun.schema.json.
function checkRun(file, expectValid, name) {
  const doc = parse(readFileSync(file, "utf8"));
  const valid = validateRun(doc);
  if (valid === expectValid) {
    console.log(`  ok      ${name}`);
  } else {
    failures++;
    console.error(`  FAILED  ${name} — expected ${expectValid ? "valid" : "invalid"}`);
    if (!valid) {
      for (const err of validateRun.errors ?? []) {
        console.error(`          ${err.instancePath || "/"} ${err.message}`);
      }
    }
  }
}

console.log("Run records (testrun.schema.json):");
const runsValid = join(schemaDir, "tests", "runs", "valid");
const runsInvalid = join(schemaDir, "tests", "runs", "invalid");
for (const [dir, expect] of [
  [runsValid, true],
  [runsInvalid, false],
]) {
  if (!existsSync(dir)) continue;
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".yaml"))
    .sort();
  if (files.length === 0) {
    failures++;
    console.error(`  FAILED  no run records in ${dir}`);
  }
  for (const f of files)
    checkRun(join(dir, f), expect, `runs/${expect ? "valid" : "invalid"}/${f}`);
}

// Runs this repository recorded itself, when present: the real thing.
const localRuns = join(schemaDir, "..", ".testfile", "runs");
if (existsSync(localRuns)) {
  for (const id of readdirSync(localRuns).sort().slice(-3)) {
    const file = join(localRuns, id, "run.yaml");
    if (existsSync(file)) checkRun(file, true, `.testfile/runs/${id}/run.yaml`);
  }
}

// Documentation is where people copy from, so its examples have to be
// real. Every ```yaml block that starts a document (`version:` on the
// first line) is validated; the many fragments that show one key in
// isolation are not documents and are skipped.
const docsDir = join(schemaDir, "..", "docs");
if (existsSync(docsDir)) {
  console.log("Documentation examples:");
  let found = 0;
  for (const file of readdirSync(docsDir)
    .filter((f) => f.endsWith(".md"))
    .sort()) {
    const text = readFileSync(join(docsDir, file), "utf8");
    const blocks = [...text.matchAll(/```yaml\n([\s\S]*?)```/g)].map((m) => m[1]);
    blocks.forEach((block, index) => {
      if (!block.trimStart().startsWith("version:")) return;
      found++;
      const name = `docs/${file}#${index + 1}`;
      let doc;
      try {
        doc = parse(block);
      } catch (err) {
        failures++;
        console.error(`  FAILED  ${name} — not YAML: ${err.message.split("\n")[0]}`);
        return;
      }
      if (validate(doc)) {
        console.log(`  ok      ${name}`);
      } else {
        failures++;
        console.error(`  FAILED  ${name}`);
        for (const err of validate.errors ?? []) {
          console.error(`          ${err.instancePath || "/"} ${err.message}`);
        }
      }
    });
  }
  if (found === 0) {
    failures++;
    console.error("  FAILED  no complete Testfile found in the documentation");
  }
}

// The "Get started" page on the website builds a Testfile from a handful of
// answers and tells the reader to copy it, so every answer it can be given
// has to produce a file the runner accepts - not just the default one.
const wizard = join(schemaDir, "..", "website", "src", "wizard.mjs");
if (existsSync(wizard)) {
  console.log("Website wizard (every combination of answers):");
  const { allAnswerCombinations, toYaml } = await import(pathToFileURL(wizard).href);
  const combinations = allAnswerCombinations();
  let bad = 0;
  for (const answers of combinations) {
    const name = `wizard ${Object.values(answers).filter(Boolean).join(" ")}`;
    let doc;
    try {
      doc = parse(toYaml(answers));
    } catch (err) {
      bad++;
      console.error(`  FAILED  ${name} — not YAML: ${err.message.split("\n")[0]}`);
      continue;
    }
    if (validate(doc)) continue;
    bad++;
    console.error(`  FAILED  ${name}`);
    for (const err of validate.errors ?? []) {
      console.error(`          ${err.instancePath || "/"} ${err.message}`);
    }
  }
  if (combinations.length === 0) {
    bad++;
    console.error("  FAILED  the wizard offers no answers");
  }
  failures += bad;
  if (bad === 0) console.log(`  ok      ${combinations.length} combinations`);
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nAll schema checks passed");
