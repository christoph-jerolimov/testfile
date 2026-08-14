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
  /** NO_DATABASE, one engine, or ALL for every engine. */
  database?: string;
  /** A version, ALL, or NEWEST when every engine is wanted. */
  dbVersion?: string;
}

export type AnswerKey = keyof Answers;

/** The answer that means "one instance per version, or per engine". */
export const ALL = "all";
export const NEWEST = "newest";
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
    label: "Node.js / TypeScript",
    image: (version) => `docker.io/library/node:${version}`,
    versions: ["24", "22", "20"],
    install: "npm ci",
    lint: "npm run lint",
    unit: "npm test",
    integration: "npm run test:integration",
    inputs: ['"src/**"', '"package-lock.json"'],
  },
  python: {
    label: "Python",
    image: (version) => `docker.io/library/python:${version}`,
    versions: ["3.13", "3.12", "3.11"],
    install: "pip install -r requirements.txt",
    lint: "ruff check .",
    unit: "pytest -q tests/unit",
    integration: "pytest -q tests/integration",
    inputs: ['"**/*.py"', '"requirements.txt"'],
  },
  go: {
    label: "Go",
    image: (version) => `docker.io/library/golang:${version}`,
    versions: ["1.25", "1.24", "1.23"],
    install: "go mod download",
    lint: "go vet ./...",
    unit: "go test ./...",
    integration: "go test -tags=integration ./...",
    inputs: ['"**/*.go"', '"go.sum"'],
  },
  java: {
    label: "Java",
    image: (version) => `docker.io/library/maven:3-eclipse-temurin-${version}`,
    versions: ["25", "21", "17"],
    install: "./mvnw -B -q dependency:go-offline",
    lint: "./mvnw -B -q spotless:check",
    unit: "./mvnw -B test",
    integration: "./mvnw -B verify -Pintegration",
    inputs: ['"src/**"', '"pom.xml"'],
  },
  rust: {
    label: "Rust",
    image: (version) => `docker.io/library/rust:${version}`,
    versions: ["1.90", "1.89"],
    install: "cargo fetch",
    lint: "cargo clippy -- -D warnings",
    unit: "cargo test",
    integration: "cargo test --test integration",
    inputs: ['"src/**"', '"Cargo.lock"'],
  },
};

// Databases as services: the image, the port it listens on inside its
// container, what it needs to boot, how it says it is ready, and the URL
// the integration test connects with.
const DATABASES: Record<string, Database> = {
  postgres: {
    label: "PostgreSQL",
    versions: ["18", "17", "16"],
    image: (version) => `docker.io/library/postgres:${version}-alpine`,
    port: 5432,
    env: [
      ["POSTGRES_PASSWORD", "test"],
      ["POSTGRES_DB", "app_test"],
    ],
    // runs inside the container, so the image's own client is used
    ready: "pg_isready -h 127.0.0.1 -p 5432 -U postgres",
    url: (port) => `postgres://postgres:test@127.0.0.1:\${{ ports.${port} }}/app_test`,
  },
  mysql: {
    label: "MySQL",
    versions: ["9", "8.4"],
    image: (version) => `docker.io/library/mysql:${version}`,
    port: 3306,
    env: [
      ["MYSQL_ROOT_PASSWORD", "test"],
      ["MYSQL_DATABASE", "app_test"],
    ],
    ready: "mysqladmin ping -h 127.0.0.1 --silent",
    url: (port) => `mysql://root:test@127.0.0.1:\${{ ports.${port} }}/app_test`,
  },
};

// One database the tests run against: which engine, which version, and the
// named port it is published on. More than one of these means the file
// needs a port per database, since ports are allocated once per run.
interface Variant {
  key: string;
  database: Database;
  version: string;
  port: string;
  name: string;
}

function variantsOf(answers: Answers): Variant[] {
  const { database, dbVersion } = answers;
  if (!database || database === NO_DATABASE) return [];
  const engines = database === ALL ? Object.keys(DATABASES) : [database];
  const pairs: Array<[string, string]> = [];
  for (const key of engines) {
    const entry = DATABASES[key];
    if (!entry) continue;
    if (dbVersion === ALL) for (const version of entry.versions) pairs.push([key, version]);
    // Newest until the version is answered, so choosing a database shows
    // what it brings straight away.
    else if (!dbVersion || !entry.versions.includes(dbVersion))
      pairs.push([key, entry.versions[0]]);
    else pairs.push([key, dbVersion]);
  }
  // The engine names the port and the test - unless the same engine is
  // there more than once, when the version has to tell them apart.
  const versions = new Map<string, number>();
  for (const [key] of pairs) versions.set(key, (versions.get(key) ?? 0) + 1);
  return pairs.map(([key, version]) => {
    const many = (versions.get(key) ?? 0) > 1;
    return {
      key,
      database: DATABASES[key],
      version,
      // port names allow letters, digits and underscores only
      port: many ? `${key}${version.replace(/\W/g, "")}` : key,
      name: many ? `${key}-${version}` : key,
    };
  });
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

  if (
    !ask({
      id: "database",
      label: "Do the tests need a database?",
      hint: "The runner starts it, waits until it really accepts connections, and stops it again — on your machine and on CI.",
      options: [
        { value: NO_DATABASE, label: "No" },
        ...Object.entries(DATABASES).map(([value, entry]) => ({ value, label: entry.label })),
        { value: ALL, label: "All of them", note: "one test per engine" },
      ],
    })
  ) {
    return out;
  }
  if (answers.database === NO_DATABASE) return out;

  const engine = answers.database ? DATABASES[answers.database] : undefined;
  ask({
    id: "dbVersion",
    label: engine ? `Which ${engine.label} version?` : "Which database versions?",
    hint: `"All of them" runs the integration test once per version, each against its own container.`,
    options: engine
      ? [
          ...engine.versions.map((value) => ({ value, label: value })),
          { value: ALL, label: "All of them", note: `${engine.versions.length} versions` },
        ]
      : [
          { value: NEWEST, label: "The newest of each" },
          { value: ALL, label: "All of them", note: "every version of both" },
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

  if (variants.length > 0) {
    // The blank lines inside this block belong to it too, so choosing a
    // database highlights one unbroken band rather than a band with holes.
    add("", "database");
    add("# A free port is picked per run, so two runs never collide.", "database");
    add("ports:", "database");
    for (const variant of variants) {
      // with one database the port is named after it; with several the name
      // has to carry the version too, so it moves with that answer
      add(`  ${variant.port}: random`, "database", ...(variants.length > 1 ? ["dbVersion"] : []));
    }
    if (variants.length === 1) {
      add("", "database");
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
    add("      env:", "database");
    add(`        DATABASE_URL: ${variants[0].database.url(variants[0].port)}`, "database");
    add(`      command: ${language.integration}`, "database", "language");
  } else if (variants.length > 1) {
    add("    - name: integration", "database");
    add("      # one run per database, each with a container of its own", "dbVersion");
    add("      parallel:", "database");
    for (const variant of variants) {
      add(`        - name: ${variant.name}`, "database", "dbVersion");
      add("          services:", "database");
      addService(add, variant, "          ", answers.version === ALL);
      add("          env:", "database");
      add(`            DATABASE_URL: ${variant.database.url(variant.port)}`, "database");
      add(`          command: ${language.integration}`, "database", "language");
    }
  }
  return lines;
}

// One service block, indented to sit where it is written: at the top level
// when there is a single database, inside a test when there are several.
//
// `shared` matters when the whole suite is a version matrix: the instances
// run at once, and without it each would start its own copy of this
// container on the same host port. Matching on the resolved configuration,
// they get one between them.
function addService(
  add: (text: string, ...from: string[]) => number,
  variant: Variant,
  indent: string,
  shared = false,
): void {
  const { database } = variant;
  add(`${indent}  ${variant.key}:`, "database");
  if (shared) {
    add(`${indent}    # one container for every instance of the matrix above`, "version");
    add(`${indent}    shared: true`, "version");
  }
  add(`${indent}    container:`, "database");
  add(`${indent}      image: ${database.image(variant.version)}`, "database", "dbVersion");
  add(`${indent}      ports: ["\${{ ports.${variant.port} }}:${database.port}"]`, "database");
  add(`${indent}      env:`, "database");
  for (const [key, value] of database.env) add(`${indent}        ${key}: ${value}`, "database");
  add(`${indent}    ready:`, "database");
  add(`${indent}      # runs inside the container, so the image's own client is used`, "database");
  add(`${indent}      exec: ${database.ready}`, "database");
  add(`${indent}      timeout: 60s`, "database");
}

/** The file as text, for copying and for quoting. */
export function toYaml(answers: Answers): string {
  return `${buildTestfile(answers)
    .map((line) => line.text)
    .join("\n")}\n`;
}
