import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { stringify } from "yaml";
import {
  emptyImport,
  importFile,
  kindOf,
  mergeImports,
  type Imported,
  type ImportKind,
} from "./importers.js";
import { TESTFILE_NAMES } from "./loader.js";
import type { TestDef } from "./model.js";

const SCHEMA_URL =
  "https://raw.githubusercontent.com/christoph-jerolimov/testfile/main/schema/testfile.schema.json";

interface PackageJson {
  name?: string;
  scripts?: Record<string, string>;
}

// Files init picks up on its own, in the order they are looked for.
const AUTO_DETECT = [
  "compose.yaml",
  "compose.yml",
  "docker-compose.yaml",
  "docker-compose.yml",
  "Taskfile.yaml",
  "Taskfile.yml",
  "justfile",
  ".justfile",
  "Makefile",
];

export function detectSources(dir: string): string[] {
  const found = AUTO_DETECT.filter((name) => existsSync(join(dir, name))).map((name) =>
    join(dir, name)
  );
  // the first workflow that has run: steps, so a project without other
  // sources still gets its CI commands
  const workflows = join(dir, ".github", "workflows");
  try {
    for (const file of readdirSync(workflows).sort()) {
      if (/\.ya?ml$/i.test(file)) {
        found.push(join(workflows, file));
        break;
      }
    }
  } catch {
    // no workflows
  }
  return found;
}

function scriptTests(pkg: PackageJson | undefined): TestDef[] {
  const scripts = pkg?.scripts ?? {};
  const checks: TestDef[] = [];
  if (scripts.lint) checks.push({ name: "lint", tags: ["fast"], command: "npm run lint" });
  if (scripts.typecheck) {
    checks.push({ name: "typecheck", tags: ["fast"], command: "npm run typecheck" });
  }
  if (scripts.test) checks.push({ name: "test", command: "npm test" });
  for (const script of Object.keys(scripts)) {
    if (/^test:/.test(script)) checks.push({ name: script.slice(5), command: `npm run ${script}` });
  }
  return checks;
}

export interface GenerateOptions {
  // Files to import; when omitted, init auto-detects them.
  sources?: string[];
  // Set to false to ignore the auto-detected files.
  detect?: boolean;
}

export interface Generated {
  content: string;
  // Files that contributed, relative to the target directory.
  imported: string[];
  notes: string[];
}

// Generates a starter Testfile from what the project already has:
// package.json scripts, plus services and commands imported from
// docker-compose files, GitHub workflows, Makefiles, Taskfiles, justfiles.
export function generate(dir: string, options: GenerateOptions = {}): Generated {
  let pkg: PackageJson | undefined;
  try {
    pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as PackageJson;
  } catch {
    // not a Node project
  }

  const sources = options.sources ?? (options.detect === false ? [] : detectSources(dir));
  const parts: Imported[] = [];
  const imported: string[] = [];
  for (const source of sources) {
    const kind: ImportKind | undefined = kindOf(source);
    if (!kind) {
      parts.push({ ...emptyImport(), notes: [`${source}: unknown file type, skipped`] });
      continue;
    }
    try {
      parts.push(importFile(source, kind));
      imported.push(relative(dir, source) || source);
    } catch (err) {
      parts.push({
        ...emptyImport(),
        notes: [`${source}: could not be read (${err instanceof Error ? err.message : err})`],
      });
    }
  }
  const merged = mergeImports(parts);

  const checks = [...scriptTests(pkg), ...merged.tests];
  const build = pkg?.scripts?.build ? { name: "build", command: "npm run build" } : undefined;

  const doc: Record<string, unknown> = { version: 0 };
  if (pkg?.name) doc.name = pkg.name;
  if (Object.keys(merged.ports).length > 0) doc.ports = merged.ports;
  if (Object.keys(merged.services).length > 0) doc.services = merged.services;

  let test: TestDef;
  if (checks.length === 0 && !build) {
    test = { name: "all", command: 'echo "no tests configured yet"' };
  } else if (!build && checks.length === 1) {
    test = { ...checks[0], name: checks[0].name ?? "all" };
  } else {
    const sequence: TestDef[] = [];
    if (build) sequence.push(build);
    if (checks.length === 1) sequence.push(checks[0]);
    else if (checks.length > 1) sequence.push({ name: "checks", parallel: checks });
    test = { name: "all", sequence };
  }
  doc.test = test;

  const header = [`# yaml-language-server: $schema=${SCHEMA_URL}`];
  if (imported.length > 0) header.push(`# imported from: ${imported.join(", ")}`);
  for (const note of merged.notes) header.push(`# note: ${note}`);
  if (checks.length === 0 && !build) header.push("# replace with how this project runs its tests");

  const body = stringify(doc, { lineWidth: 0 });
  return { content: `${header.join("\n")}\n${body}`, imported, notes: merged.notes };
}

// Kept for callers that only want the file's content.
export function generateTestfile(dir: string): string {
  return generate(dir).content;
}

export function initTestfile(
  pathOrDir: string,
  options: GenerateOptions = {}
): { path: string; content: string; imported: string[]; notes: string[] } {
  const dir = resolve(pathOrDir);
  for (const name of TESTFILE_NAMES) {
    if (existsSync(join(dir, name))) {
      throw new Error(`${join(dir, name)} already exists`);
    }
  }
  const generated = generate(dir, options);
  const path = join(dir, "Testfile");
  writeFileSync(path, generated.content);
  return { path, ...generated };
}
