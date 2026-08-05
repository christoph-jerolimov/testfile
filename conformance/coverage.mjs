// Every normative section of the specification must have a case.
//
// The suite's convention was written down but not enforced: "every change to
// the execution semantics must add or adjust a case here". This makes it
// mechanical. Each case's expected.yaml names the spec sections it pins:
//
//   spec:
//     - Services
//     - Readiness (ready)
//
// and this check reports sections nobody covers, names that no longer exist
// (a renamed heading) and cases that declare nothing at all. Sections that
// describe rather than prescribe - the glossary, the file naming - are
// exempt here, with the reason spelled out.
//
// Section names are the headings of spec/README.md with backticks removed.
// A case may also point at the result format with a "RESULTS.md#" prefix;
// those references are validated but not required to be covered - the
// result format is checked by the schema and the viewer's tests.
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parse } from "yaml";

const here = dirname(fileURLToPath(import.meta.url));
export const CASES_DIR = join(here, "cases");
export const SPEC = join(here, "..", "spec", "README.md");
export const RESULTS_SPEC = join(here, "..", "spec", "RESULTS.md");
export const RESULTS_PREFIX = "RESULTS.md#";

// Sections that cannot be pinned by running a Testfile, and why.
export const NOT_EXECUTABLE = {
  File: "file names, encoding and the version field - the schema tests cover it",
  Concepts: "the glossary; the terms are exercised by every other case",
};

// "### Readiness (`ready`)" -> "Readiness (ready)"
export function headings(markdown) {
  const out = [];
  let inFence = false;
  for (const line of markdown.split("\n")) {
    if (line.startsWith("```")) inFence = !inFence;
    if (inFence) continue;
    const match = /^(#{2,3})\s+(.*?)\s*$/.exec(line);
    if (match) out.push(match[2].replaceAll("`", ""));
  }
  return out;
}

export function readCases(dir = CASES_DIR) {
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .map((id) => {
      const expected = parse(readFileSync(join(dir, id, "expected.yaml"), "utf8")) ?? {};
      const spec = expected.spec ?? [];
      return { id, sections: Array.isArray(spec) ? spec : [spec] };
    });
}

// Returns { problems, coverage } - coverage maps a section to the cases
// that pin it, in case order.
export function checkCoverage(cases, specHeadings, resultHeadings) {
  const problems = [];
  const coverage = new Map(specHeadings.map((section) => [section, []]));

  for (const { id, sections } of cases) {
    if (sections.length === 0) {
      problems.push(`${id}: expected.yaml declares no "spec:" section`);
      continue;
    }
    for (const section of sections) {
      if (section.startsWith(RESULTS_PREFIX)) {
        const heading = section.slice(RESULTS_PREFIX.length);
        if (!resultHeadings.includes(heading)) {
          problems.push(`${id}: spec/RESULTS.md has no "${heading}" section`);
        }
        continue;
      }
      const known = coverage.get(section);
      if (!known) {
        problems.push(`${id}: spec/README.md has no "${section}" section`);
        continue;
      }
      known.push(id);
    }
  }

  for (const [section, ids] of coverage) {
    if (ids.length > 0 || section in NOT_EXECUTABLE) continue;
    problems.push(
      `no case covers "${section}" - add one, or list the section in NOT_EXECUTABLE with a reason`,
    );
  }
  for (const section of Object.keys(NOT_EXECUTABLE)) {
    if (!coverage.has(section)) {
      problems.push(`NOT_EXECUTABLE names "${section}", which is no longer a spec section`);
    }
  }
  return { problems, coverage };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const cases = readCases();
  const specHeadings = headings(readFileSync(SPEC, "utf8"));
  const { problems, coverage } = checkCoverage(
    cases,
    specHeadings,
    headings(readFileSync(RESULTS_SPEC, "utf8")),
  );

  const width = Math.max(...specHeadings.map((section) => section.length));
  for (const [section, ids] of coverage) {
    const exempt = NOT_EXECUTABLE[section];
    const covered = ids.length > 0 ? ids.join(", ") : exempt ? `- exempt: ${exempt}` : "- NO CASE";
    console.log(`${section.padEnd(width)}  ${covered}`);
  }
  console.log(
    `\n${coverage.size} spec sections, ${cases.length} cases, ` +
      `${Object.keys(NOT_EXECUTABLE).length} exempt`,
  );

  for (const problem of problems) console.error(`✘ ${problem}`);
  if (problems.length > 0) {
    console.error(`\n${problems.length} coverage problem(s)`);
    process.exit(1);
  }
  console.log("every spec section has a conformance case");
}
