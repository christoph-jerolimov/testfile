import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { TESTFILE_NAMES } from "./loader.js";

const SCHEMA_URL =
  "https://raw.githubusercontent.com/christoph-jerolimov/testfile/main/schema/testfile.schema.json";

interface PackageJson {
  name?: string;
  scripts?: Record<string, string>;
}

// Generates a starter Testfile for the given directory by sniffing
// package.json scripts; falls back to a commented template.
export function generateTestfile(dir: string): string {
  let pkg: PackageJson | undefined;
  try {
    pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as PackageJson;
  } catch {
    // not a Node project; use the generic template
  }
  const scripts = pkg?.scripts ?? {};

  const lines: string[] = [`# yaml-language-server: $schema=${SCHEMA_URL}`, "version: 0"];
  if (pkg?.name) lines.push(`name: ${pkg.name}`);

  const checks: { name: string; command: string; tags?: string[] }[] = [];
  if (scripts.lint) checks.push({ name: "lint", command: "npm run lint", tags: ["fast"] });
  if (scripts.typecheck) checks.push({ name: "typecheck", command: "npm run typecheck", tags: ["fast"] });
  if (scripts.test) checks.push({ name: "test", command: "npm test" });
  for (const script of Object.keys(scripts)) {
    if (/^test:/.test(script)) {
      checks.push({ name: script.slice(5), command: `npm run ${script}` });
    }
  }
  const build = scripts.build ? { name: "build", command: "npm run build" } : undefined;

  const emitLeaf = (leaf: { name: string; command: string; tags?: string[] }, indent: string): void => {
    lines.push(`${indent}- name: ${leaf.name}`);
    if (leaf.tags) lines.push(`${indent}  tags: [${leaf.tags.join(", ")}]`);
    lines.push(`${indent}  command: ${leaf.command}`);
  };

  lines.push("test:");
  if (checks.length === 0 && !build) {
    lines.push("  name: all");
    lines.push("  # replace with how this project runs its tests");
    lines.push('  command: echo "no tests configured yet"');
  } else if (!build && checks.length === 1) {
    lines.push(`  name: ${checks[0].name}`);
    lines.push(`  command: ${checks[0].command}`);
  } else {
    lines.push("  name: all");
    lines.push("  sequence:");
    if (build) emitLeaf(build, "    ");
    if (checks.length === 1) {
      emitLeaf(checks[0], "    ");
    } else if (checks.length > 1) {
      lines.push("    - name: checks");
      lines.push("      parallel:");
      for (const check of checks) emitLeaf(check, "        ");
    }
  }
  return `${lines.join("\n")}\n`;
}

export function initTestfile(pathOrDir: string): { path: string; content: string } {
  const dir = resolve(pathOrDir);
  for (const name of TESTFILE_NAMES) {
    if (existsSync(join(dir, name))) {
      throw new Error(`${join(dir, name)} already exists`);
    }
  }
  const content = generateTestfile(dir);
  const path = join(dir, "Testfile");
  writeFileSync(path, content);
  return { path, content };
}
