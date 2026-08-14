import assert from "node:assert/strict";
import { test } from "node:test";
import { applyConfigOverrides, parseOverrideValue } from "./configenv.js";

function doc(): Record<string, unknown> {
  return {
    version: 0,
    ports: { db: "random" },
    services: {
      postgres: {
        container: { image: "docker.io/library/postgres:16", ports: ["${{ ports.db }}:5432"] },
        ready: { tcp: "${{ ports.db }}", timeout: "30s" },
      },
    },
    test: {
      name: "ci",
      sequence: [
        { name: "unit", command: "npm run test:unit" },
        { name: "e2e", command: "npm run test:e2e", tags: ["slow"] },
      ],
    },
  };
}

test("a value stays the string it is unless it announces otherwise", () => {
  assert.equal(parseOverrideValue("npm run test:unit"), "npm run test:unit");
  assert.equal(
    parseOverrideValue("docker.io/library/postgres:17"),
    "docker.io/library/postgres:17",
  );
  assert.equal(parseOverrideValue("1.20.3"), "1.20.3", "two dots is a version, not a number");
  assert.equal(parseOverrideValue("0755"), "0755", "a padded number is an identifier");
  assert.equal(parseOverrideValue("15432"), 15432);
  assert.equal(parseOverrideValue("-3"), -3);
  assert.equal(parseOverrideValue("1.5"), 1.5);
  assert.equal(parseOverrideValue("true"), true);
  assert.equal(parseOverrideValue("false"), false);
  assert.equal(parseOverrideValue("null"), null);
  assert.deepEqual(parseOverrideValue("[fast, smoke]"), ["fast", "smoke"]);
  assert.deepEqual(parseOverrideValue("{count: 2, delay: 1s}"), { count: 2, delay: "1s" });
  // quoting is the escape hatch for a string that would be read as something else
  assert.equal(parseOverrideValue('"true"'), "true");
  assert.equal(parseOverrideValue("'15432'"), "15432");
});

test("a value that opens a list or map but is not YAML says so", () => {
  assert.throws(() => parseOverrideValue("[unclosed"), /not valid YAML/);
});

test("overrides reach ports, services, containers and a test in a sequence", () => {
  const target = doc();
  const applied = applyConfigOverrides(target, {
    TESTFILE_CONFIG_ports__db: "15432",
    TESTFILE_CONFIG_services__postgres__container__image: "docker.io/library/postgres:17",
    TESTFILE_CONFIG_test__sequence__1__command: "npm run test:e2e -- --headed",
    TESTFILE_CONFIG_test__sequence__1__tags: "[slow, flaky]",
    NOT_AN_OVERRIDE: "ignored",
  });
  assert.deepEqual(
    applied.map((override) => override.path),
    [
      "ports.db",
      "services.postgres.container.image",
      "test.sequence.1.command",
      "test.sequence.1.tags",
    ],
  );
  // each one also says where it came from and what it carried, so a run
  // can be repeated from its own record
  assert.deepEqual(applied[0], {
    path: "ports.db",
    from: "TESTFILE_CONFIG_ports__db",
    value: "15432",
  });
  const services = target.services as Record<string, { container: { image: string } }>;
  const tests = (target.test as { sequence: Record<string, unknown>[] }).sequence;
  assert.deepEqual(target.ports, { db: 15432 });
  assert.equal(services.postgres.container.image, "docker.io/library/postgres:17");
  assert.equal(tests[1].command, "npm run test:e2e -- --headed");
  assert.deepEqual(tests[1].tags, ["slow", "flaky"]);
  assert.equal(tests[0].command, "npm run test:unit", "nothing else moved");
});

test("a path that does not exist yet is created, so a block can be added", () => {
  const target = doc();
  applyConfigOverrides(target, { TESTFILE_CONFIG_test__sequence__0__env__DEBUG: "1" });
  const tests = (target.test as { sequence: Record<string, unknown>[] }).sequence;
  assert.deepEqual(tests[0].env, { DEBUG: 1 });
});

test("segments match a key case-insensitively, and _ stands in for -", () => {
  const target = {
    version: 0,
    services: { "my-db": { container: { image: "postgres:16" } } },
    test: { maxParallel: 2, parallel: [{ command: "a" }] },
  };
  applyConfigOverrides(target, {
    // an env var name can hold neither a dash nor, on Windows, lower case
    TESTFILE_CONFIG_SERVICES__MY_DB__CONTAINER__IMAGE: "postgres:17",
    TESTFILE_CONFIG_TEST__MAXPARALLEL: "4",
  });
  assert.equal(target.services["my-db"].container.image, "postgres:17");
  assert.equal(target.test.maxParallel, 4);
});

test("a path into a list must be an index that exists", () => {
  assert.throws(
    () => applyConfigOverrides(doc(), { TESTFILE_CONFIG_test__sequence__unit__command: "x" }),
    /test\.sequence is a list, so "unit" must be an index/,
  );
  assert.throws(
    () => applyConfigOverrides(doc(), { TESTFILE_CONFIG_test__sequence__7__command: "x" }),
    /has 2 entries, so index 7 is out of range/,
  );
});

test("a path that runs into a value stops rather than replacing it silently", () => {
  assert.throws(
    () => applyConfigOverrides(doc(), { TESTFILE_CONFIG_test__sequence__0__command__extra: "x" }),
    /test\.sequence\.0\.command is a value, so nothing can be set inside it/,
  );
});

test("a malformed variable name is rejected with the name in the message", () => {
  assert.throws(
    () => applyConfigOverrides(doc(), { TESTFILE_CONFIG_test____command: "x" }),
    /TESTFILE_CONFIG_test____command: not a path/,
  );
});

test("overrides are applied in a deterministic order", () => {
  const target = doc();
  const applied = applyConfigOverrides(target, {
    TESTFILE_CONFIG_test__name: "second",
    TESTFILE_CONFIG_ports__db: "1",
  });
  assert.deepEqual(
    applied.map((override) => override.path),
    ["ports.db", "test.name"],
    "sorted by variable name",
  );
});
