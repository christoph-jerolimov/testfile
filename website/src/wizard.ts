// The starter Testfile the "Get started" page builds from a handful of
// answers, as one pure function so the server render and the browser render
// cannot disagree.
//
// The questions are asked one at a time: nothing is preselected, and the
// next question appears once the current one is answered. The file grows
// with them, and each generated line carries the ids of the questions that
// decided it, so the page can highlight exactly what the last answer
// changed.
//
// Nothing here is imported by a test. What the page produces is checked
// through the page itself, against files written by hand - see
// e2e/wizard.spec.ts and e2e/expected/.

export interface Option {
  value: string;
  label: string;
  note?: string;
}

export interface Question {
  id: AnswerKey;
  label: string;
  hint?: string;
  options: Option[];
}

/** A generated line, with the questions that decided it. */
export interface Line {
  text: string;
  from: string[];
}

/** Every answer is optional: unanswered means the question is still open. */
export interface Answers {
  language?: string;
  /** A version, or ALL for one instance per version. */
  version?: string;
  /** Not asked when every version is wanted - those need a container. */
  runtime?: string;
  /** NO_DATABASE, a version of the database, or ALL for every version. */
  database?: string;
}

export type AnswerKey = keyof Answers;

/** The answer that means "one instance per version". */
export const ALL = "all";
const NO_DATABASE = "none";

interface Language {
  label: string;
  image: (version: string) => string;
  versions: string[];
  install: string;
  lint: string;
  unit: string;
  integration: string;
  inputs: string[];
}

interface Database {
  label: string;
  key: string;
  versions: string[];
  image: (version: string) => string;
  port: number;
  env: Array<[string, string]>;
  ready: string;
  url: (port: string) => string;
}

// Language-specific facts: the image a container build uses, the commands
// the tests run, and how the language usually installs dependencies.
const LANGUAGES: Record<string, Language> = {
  node: {
    label: "Node.js",
    image: (version) => `docker.io/library/node:${version}`,
    versions: ["20", "22", "24"],
    install: "npm ci",
    lint: "npm run lint",
    unit: "npm test",
    integration: "npm run test:integration",
    inputs: ['"src/**"', '"package-lock.json"'],
  },
  python: {
    label: "Python",
    image: (version) => `docker.io/library/python:${version}`,
    versions: ["3.11", "3.12", "3.13"],
    install: "pip install -r requirements.txt",
    lint: "ruff check .",
    unit: "pytest -q tests/unit",
    integration: "pytest -q tests/integration",
    inputs: ['"**/*.py"', '"requirements.txt"'],
  },
  go: {
    label: "Go",
    image: (version) => `docker.io/library/golang:${version}`,
    versions: ["1.23", "1.24", "1.25"],
    install: "go mod download",
    lint: "go vet ./...",
    unit: "go test ./...",
    integration: "go test -tags=integration ./...",
    inputs: ['"**/*.go"', '"go.sum"'],
  },
  java: {
    label: "Java",
    image: (version) => `docker.io/library/maven:3-eclipse-temurin-${version}`,
    versions: ["17", "21", "25"],
    install: "./mvnw -B -q dependency:go-offline",
    lint: "./mvnw -B -q spotless:check",
    unit: "./mvnw -B test",
    integration: "./mvnw -B verify -Pintegration",
    inputs: ['"src/**"', '"pom.xml"'],
  },
  rust: {
    label: "Rust",
    image: (version) => `docker.io/library/rust:${version}`,
    versions: ["1.89", "1.90"],
    install: "cargo fetch",
    lint: "cargo clippy -- -D warnings",
    unit: "cargo test",
    integration: "cargo test --test integration",
    inputs: ['"src/**"', '"Cargo.lock"'],
  },
};

// The database as a service: the image, the port it listens on inside its
// container, what it needs to boot, how it says it is ready, and the URL
// the integration test connects with.
//
// One engine, on purpose. A starter file wants a database that works, not a
// choice of them; anything else is the same shape with its own image,
// readiness check and URL.
const DATABASE: Database = {
  label: "PostgreSQL",
  key: "postgres",
  versions: ["16", "17", "18"],
  image: (version) => `docker.io/library/postgres:${version}-alpine`,
  port: 5432,
  env: [
    ["POSTGRES_PASSWORD", "test"],
    ["POSTGRES_DB", "app_test"],
  ],
  // runs inside the container, so the image's own client is used
  ready: "pg_isready -h 127.0.0.1 -p 5432 -U postgres",
  url: (port) => `postgres://postgres:test@127.0.0.1:\${{ ports.${port} }}/app_test`,
};

// One database the tests run against: which version, and the named port it
// is published on. More than one of these means the file needs a port per
// database, since ports are allocated once per run.
interface Variant {
  version: string;
  port: string;
  name: string;
}

function variantsOf(answers: Answers): Variant[] {
  const { database } = answers;
  if (!database || database === NO_DATABASE) return [];
  const wanted = database === ALL ? DATABASE.versions : [database];
  const many = wanted.length > 1;
  return wanted.map((version) => ({
    version,
    // port names allow letters, digits and underscores only, and only need
    // the version when there is more than one to tell apart
    port: many ? `${DATABASE.key}${version.replace(/\W/g, "")}` : DATABASE.key,
    name: many ? `${DATABASE.key}-${version}` : DATABASE.key,
  }));
}

// The questions, in the order they are asked - up to and including the
// first one that has no answer yet. Nothing is preselected, so the page
// starts with one question and grows.
export function questions(answers: Answers = {}): Question[] {
  const language = answers.language ? LANGUAGES[answers.language] : undefined;
  const out: Question[] = [];
  // Adds a question, and reports whether it has been answered - the caller
  // stops at the first one that has not.
  const ask = (question: Question): boolean => {
    out.push(question);
    return question.options.some((option) => option.value === answers[question.id]);
  };

  const answered = ask({
    id: "language",
    label: "What is the project written in?",
    options: Object.entries(LANGUAGES).map(([value, entry]) => ({ value, label: entry.label })),
  });
  if (!answered || !language) return out;

  const name = language.label.split(" ")[0];
  if (
    !ask({
      id: "version",
      label: `Which ${name} version?`,
      hint: `"All of them" builds a matrix: the suite runs once per version, each in its own container.`,
      options: [
        ...language.versions.map((value) => ({ value, label: value })),
        { value: ALL, label: "All of them", note: `${language.versions.length} versions` },
      ],
    })
  ) {
    return out;
  }

  // A version matrix only means something in containers - nothing else can
  // give one machine three toolchains - so that answer settles this one.
  if (answers.version !== ALL) {
    if (
      !ask({
        id: "runtime",
        label: "Where do the tests run?",
        hint: "A container pins the toolchain for everyone; running locally is faster and uses what you have installed.",
        options: [
          { value: "local", label: "On this machine", note: "whatever is installed" },
          { value: "container", label: "In a container", note: `pinned to ${answers.version}` },
        ],
      })
    ) {
      return out;
    }
  }

  // Every version of the database is one fan-out too many once the suite
  // is already running once per language version: the copies run at the
  // same time, and a port is allocated once for the whole run, so they
  // would fight over it.
  const everyVersion = answers.version !== ALL;
  ask({
    id: "database",
    label: `Use a database like ${DATABASE.label}`,
    hint: everyVersion
      ? `The runner starts it, waits until it really accepts connections, and stops it again — on your machine and on CI. "All of them" runs the integration test once per version, each against its own container.`
      : `The runner starts it, waits until it really accepts connections, and stops it again. One version here: the suite already runs once per ${language.label.split(" ")[0]} version, and they share this database.`,
    options: [
      { value: NO_DATABASE, label: "No database" },
      ...DATABASE.versions.map((value) => ({ value, label: value })),
      ...(everyVersion
        ? [{ value: ALL, label: "All of them", note: `${DATABASE.versions.length} versions` }]
        : []),
    ],
  });
  return out;
}

/**
 * The Testfile for the answers given so far, line by line. Empty until the
 * first question is answered - before that there is no project to describe.
 */
export function buildTestfile(answers: Answers = {}): Line[] {
  const language = answers.language ? LANGUAGES[answers.language] : undefined;
  if (!language) return [];
  const variants = variantsOf(answers);
  const lines: Line[] = [];
  const add = (text: string, ...from: string[]): number => lines.push({ text, from });

  add("version: 0");

  // A database belongs to the test that needs it, and is started and
  // stopped around it - except under the matrix below, where the instances
  // run at once and would each start their own on the one port a run
  // allocates. There it is declared for the run instead.
  const perRun = answers.version === ALL;
  if (variants.length > 0) {
    // The blank lines inside this block belong to it too, so choosing a
    // database highlights one unbroken band rather than a band with holes.
    add("", "database");
    add("# A free port is picked per run, so two runs never collide.", "database");
    add("ports:", "database");
    for (const variant of variants) add(`  ${variant.port}: random`, "database");
    if (perRun) {
      add("", "database");
      add("# Up here, not under the test below: the instances of the matrix", "database");
      add("# run at once, and one database serves all of them.", "database");
      add("services:", "database");
      addService(add, variants[0], "");
    }
  }

  add("");
  add("test:");
  add("  name: ci");
  if (answers.version === ALL) {
    add("  # one instance per version, each in its own container", "version");
    add("  matrix:", "version");
    add(
      `    ${answers.language}: [${language.versions.map((v) => `"${v}"`).join(", ")}]`,
      "version",
    );
    add("  container:", "version");
    add(
      `    image: ${language.image(`\${{ matrix.${answers.language} }}`)}`,
      "version",
      "language",
    );
  } else if (answers.runtime === "container") {
    add("  # every command below runs in this image, with the project mounted", "runtime");
    add("  container:", "runtime");
    add(`    image: ${language.image(answers.version ?? "")}`, "runtime", "version", "language");
  } else if (answers.version) {
    add(
      `  # the project targets ${language.label.split(" ")[0]} ${answers.version}; this runs with whatever is installed`,
      "runtime",
      "version",
    );
  }
  add("  sequence:");
  add("    - name: install", "language");
  add(`      command: ${language.install}`, "language");
  add("    - name: lint", "language");
  add(`      command: ${language.lint}`, "language");
  add("    - name: unit", "language");
  add(`      command: ${language.unit}`, "language");
  add("      # skipped when none of these changed since the last passing run", "language");
  add(`      inputs: [${language.inputs.join(", ")}]`, "language");

  if (variants.length === 1) {
    add("    - name: integration", "database");
    if (!perRun) {
      // started before this test and stopped after it, and nothing else
      // in the file can reach it
      add("      services:", "database");
      addService(add, variants[0], "      ");
    }
    add("      env:", "database");
    add(`        DATABASE_URL: ${DATABASE.url(variants[0].port)}`, "database");
    add(`      command: ${language.integration}`, "database", "language");
  } else if (variants.length > 1) {
    add("    - name: integration", "database");
    add("      # one run per version, each with a container of its own", "database");
    add("      parallel:", "database");
    for (const variant of variants) {
      add(`        - name: ${variant.name}`, "database");
      add("          services:", "database");
      addService(add, variant, "          ");
      add("          env:", "database");
      add(`            DATABASE_URL: ${DATABASE.url(variant.port)}`, "database");
      add(`          command: ${language.integration}`, "database", "language");
    }
  }
  return lines;
}

// One service block, indented to sit where it is written: at the top level
// when there is a single database, inside a test when there are several.
function addService(
  add: (text: string, ...from: string[]) => number,
  variant: Variant,
  indent: string,
): void {
  add(`${indent}  ${DATABASE.key}:`, "database");
  add(`${indent}    container:`, "database");
  add(`${indent}      image: ${DATABASE.image(variant.version)}`, "database");
  add(`${indent}      ports: ["\${{ ports.${variant.port} }}:${DATABASE.port}"]`, "database");
  add(`${indent}      env:`, "database");
  for (const [key, value] of DATABASE.env) add(`${indent}        ${key}: ${value}`, "database");
  add(`${indent}    ready:`, "database");
  add(`${indent}      # runs inside the container, so the image's own client is used`, "database");
  add(`${indent}      exec: ${DATABASE.ready}`, "database");
  add(`${indent}      timeout: 60s`, "database");
}

/** The file as text, for copying and for quoting. */
export function toYaml(answers: Answers): string {
  return `${buildTestfile(answers)
    .map((line) => line.text)
    .join("\n")}\n`;
}
