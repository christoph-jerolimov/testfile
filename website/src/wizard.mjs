// The starter Testfile the "Get started" page builds from a handful of
// answers, as one pure function so the server render and the browser render
// cannot disagree.
//
// Each generated line carries the ids of the questions that decided it, so
// the page can highlight exactly what the last answer changed.
//
// Nothing here is imported by a test. What the page produces is checked
// through the page itself, against files written by hand - see
// e2e/wizard.spec.ts and e2e/expected/.

/**
 * @typedef {{ id: string, label: string, hint?: string, options: Option[] }} Question
 * @typedef {{ value: string, label: string, note?: string }} Option
 * @typedef {{ text: string, from: string[] }} Line
 */

// Language-specific facts: the image a container build uses, the commands
// the tests run, and how the language usually installs dependencies.
const LANGUAGES = {
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
const DATABASES = {
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
    url: "postgres://postgres:test@127.0.0.1:${{ ports.db }}/app_test",
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
    url: "mysql://root:test@127.0.0.1:${{ ports.db }}/app_test",
  },
};

export const DEFAULT_ANSWERS = {
  language: "node",
  runtime: "local",
  version: "22",
  database: "none",
  dbVersion: "17",
};

// The questions, in the order they are asked. `version` and `dbVersion`
// only apply once an earlier answer made them mean something.
export function questions(answers = DEFAULT_ANSWERS) {
  const language = LANGUAGES[answers.language] ?? LANGUAGES.node;
  const database = DATABASES[answers.database];
  /** @type {Question[]} */
  const all = [
    {
      id: "language",
      label: "What is the project written in?",
      options: Object.entries(LANGUAGES).map(([value, entry]) => ({
        value,
        label: entry.label,
      })),
    },
    {
      id: "runtime",
      label: "Where do the tests run?",
      hint: "A container pins the toolchain for everyone; running locally is faster and uses what you have installed.",
      options: [
        { value: "local", label: "On this machine", note: "whatever is installed" },
        { value: "container", label: "In a container", note: "pinned image" },
      ],
    },
  ];
  if (answers.runtime === "container") {
    all.push({
      id: "version",
      label: `Which ${language.label.split(" ")[0]} version?`,
      hint: "This is the image tag, so everyone tests against the same one. Running locally there is nothing to pin — testfile doctor reports what the machine is missing instead.",
      options: language.versions.map((value) => ({ value, label: value })),
    });
  }
  all.push({
    id: "database",
    label: "Do the tests need a database?",
    hint: "The runner starts it, waits until it really accepts connections, and stops it again — on your machine and on CI.",
    options: [
      { value: "none", label: "No" },
      ...Object.entries(DATABASES).map(([value, entry]) => ({ value, label: entry.label })),
    ],
  });
  if (database) {
    all.push({
      id: "dbVersion",
      label: `Which ${database.label} version?`,
      options: database.versions.map((value) => ({ value, label: value })),
    });
  }
  return all;
}

// Answers with the gaps filled in: a version that belongs to the chosen
// language, a database version that belongs to the chosen database.
export function normalize(answers = {}) {
  const merged = { ...DEFAULT_ANSWERS, ...answers };
  const language = LANGUAGES[merged.language] ? merged.language : DEFAULT_ANSWERS.language;
  const database =
    merged.database in DATABASES || merged.database === "none" ? merged.database : "none";
  const versions = LANGUAGES[language].versions;
  const dbVersions = DATABASES[database]?.versions;
  return {
    language,
    runtime: merged.runtime === "container" ? "container" : "local",
    version: versions.includes(merged.version) ? merged.version : versions[0],
    database,
    dbVersion:
      dbVersions && dbVersions.includes(merged.dbVersion) ? merged.dbVersion : dbVersions?.[0],
  };
}

/**
 * The Testfile for one set of answers, line by line.
 * @returns {Line[]}
 */
export function buildTestfile(rawAnswers = {}) {
  const answers = normalize(rawAnswers);
  const language = LANGUAGES[answers.language];
  const database = DATABASES[answers.database];
  /** @type {Line[]} */
  const lines = [];
  const add = (text, ...from) => lines.push({ text, from });

  add("version: 0");

  if (database) {
    // The blank lines inside this block belong to it too, so choosing a
    // database highlights one unbroken band rather than a band with holes.
    add("", "database");
    add("# A free port is picked per run, so two runs never collide.", "database");
    add("ports:", "database");
    add("  db: random", "database");
    add("", "database");
    add("services:", "database");
    add(`  ${answers.database}:`, "database");
    add("    container:", "database");
    add(`      image: ${database.image(answers.dbVersion)}`, "database", "dbVersion");
    add(`      ports: ["\${{ ports.db }}:${database.port}"]`, "database");
    add("      env:", "database");
    for (const [key, value] of database.env) add(`        ${key}: ${value}`, "database");
    add("    ready:", "database");
    add("      # runs inside the container, so the image's own client is used", "database");
    add(`      exec: ${database.ready}`, "database");
    add("      timeout: 60s", "database");
  }

  add("");
  add("test:");
  add("  name: ci");
  if (answers.runtime === "container") {
    add("  # every command below runs in this image, with the project mounted", "runtime");
    add("  container:", "runtime");
    add(`    image: ${language.image(answers.version)}`, "runtime", "version", "language");
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
  if (database) {
    add("    - name: integration", "database");
    add("      env:", "database");
    add(`        DATABASE_URL: ${database.url}`, "database", "dbVersion");
    add(`      command: ${language.integration}`, "database", "language");
  }
  return lines;
}

// The file as text, for copying and for validating.
export function toYaml(answers) {
  return `${buildTestfile(answers)
    .map((line) => line.text)
    .join("\n")}\n`;
}
