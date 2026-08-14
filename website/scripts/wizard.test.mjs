// The "Get started" page is a generator with a form around it. The schema
// check already proves every answer produces a valid Testfile; what is left
// to pin here is the behaviour a reader sees - which questions exist, and
// which lines an answer is responsible for.
import assert from "node:assert/strict";
import { test } from "node:test";
import { parse } from "yaml";
import {
  allAnswerCombinations,
  buildTestfile,
  DEFAULT_ANSWERS,
  normalize,
  questions,
  toYaml,
} from "../src/wizard.mjs";

const ids = (answers) => questions(answers).map((question) => question.id);

test("a question is only asked once an earlier answer gave it a meaning", () => {
  assert.deepEqual(ids({ ...DEFAULT_ANSWERS, runtime: "local", database: "none" }), [
    "language",
    "runtime",
    "database",
  ]);
  // running locally there is no image to tag, so no version to pick
  assert.ok(ids({ ...DEFAULT_ANSWERS, runtime: "container" }).includes("version"));
  assert.ok(ids({ ...DEFAULT_ANSWERS, database: "postgres" }).includes("dbVersion"));
});

test("every question offers the answer it is asked with", () => {
  for (const answers of allAnswerCombinations()) {
    for (const question of questions(answers)) {
      const values = question.options.map((option) => option.value);
      assert.ok(
        values.includes(answers[question.id]),
        `${question.id}: ${answers[question.id]} is not offered`,
      );
    }
  }
});

test("versions that belong to another language are replaced, not carried over", () => {
  // switching from Node 22 to Go, "22" means nothing - the newest wins
  assert.equal(normalize({ language: "go", version: "22" }).version, "1.25");
  assert.equal(normalize({ language: "node", version: "20" }).version, "20");
  assert.equal(normalize({ database: "none" }).dbVersion, undefined);
  assert.equal(normalize({ database: "mysql", dbVersion: "17" }).dbVersion, "9");
});

test("nonsense answers fall back rather than generating a broken file", () => {
  const answers = normalize({ language: "cobol", runtime: "somewhere", database: "oracle" });
  assert.deepEqual(answers, {
    language: "node",
    runtime: "local",
    version: "22",
    database: "none",
    dbVersion: undefined,
  });
});

test("each line names the questions that decided it", () => {
  const lines = buildTestfile({ language: "node", runtime: "container", version: "22" });
  const from = (needle) =>
    lines.filter((line) => line.text.includes(needle)).flatMap((l) => l.from);
  assert.deepEqual(from("image: docker.io/library/node:22"), ["runtime", "version", "language"]);
  // the version question only moves the image line, nothing else
  const versionLines = lines.filter((line) => line.from.includes("version"));
  assert.equal(versionLines.length, 1);
  // `version: 0` is the format's, not an answer's - it must never light up
  assert.deepEqual(lines[0], { text: "version: 0", from: [] });
});

test("a database adds the service, the port and the test that uses it", () => {
  const before = buildTestfile({ database: "none" });
  const after = buildTestfile({ database: "postgres", dbVersion: "17" });
  assert.ok(after.length > before.length);
  const changed = after.filter((line) => line.from.includes("database"));
  assert.equal(changed.length, after.length - before.length);
  const doc = parse(toYaml({ database: "postgres", dbVersion: "17" }));
  assert.equal(doc.services.postgres.container.image, "docker.io/library/postgres:17-alpine");
  assert.deepEqual(doc.ports, { db: "random" });
  assert.equal(doc.test.sequence.at(-1).name, "integration");
});

test("the file is YAML with a root test, whatever the answers", () => {
  for (const answers of allAnswerCombinations()) {
    const doc = parse(toYaml(answers));
    assert.equal(doc.version, 0);
    assert.ok(doc.test.sequence.length >= 3, JSON.stringify(answers));
  }
});

test("choosing to run in a container puts every command in it", () => {
  const local = parse(toYaml({ runtime: "local" }));
  const container = parse(toYaml({ runtime: "container", version: "24" }));
  assert.equal(local.test.container, undefined);
  assert.equal(container.test.container.image, "docker.io/library/node:24");
});
