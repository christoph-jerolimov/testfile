import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { maskSecrets, parseEnvFile } from "./envfile.js";
import { RunHistory } from "./history.js";
import { Session } from "./session.js";

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "testfile-envfile-"));
  process.on("exit", () => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test("parseEnvFile handles comments, export, quotes and inline comments", () => {
  const parsed = parseEnvFile(
    [
      "# a comment",
      "",
      "PLAIN=value",
      "export EXPORTED=yes",
      'DOUBLE="quoted value"',
      "SINGLE='single # not a comment'",
      "TRAILING=value # comment",
    ].join("\n"),
    "test"
  );
  assert.deepEqual(parsed, {
    PLAIN: "value",
    EXPORTED: "yes",
    DOUBLE: "quoted value",
    SINGLE: "single # not a comment",
    TRAILING: "value",
  });
  assert.throws(() => parseEnvFile("NOT A PAIR", "test"), /line 1/);
});

test("maskSecrets replaces values but leaves short ones alone", () => {
  assert.equal(maskSecrets("token=supersecret rest", ["supersecret"]), "token=*** rest");
  assert.equal(maskSecrets("x=ab y=cd", ["ab"]), "x=ab y=cd");
});

test("envFile values reach tests, explicit env wins, logs are masked", async () => {
  const dir = tempDir();
  writeFileSync(join(dir, ".env.test"), "SECRET=supersecretvalue\nOVERRIDDEN=from-file\n");
  const session = new Session(
    {
      version: 1,
      envFile: ".env.test",
      env: { OVERRIDDEN: "explicit" },
      test: {
        name: "t",
        script: 'echo "secret is $SECRET"\ntest "$OVERRIDDEN" = explicit',
      },
    },
    dir
  );
  assert.equal(await session.runAll(), "passed");
  // live output contains the value; the persisted log does not
  const history = new RunHistory(dir);
  const latest = history.latestFor("t")!;
  const log = history.readLog(latest.run, latest.test)!;
  assert.match(log, /secret is \*\*\*/);
  assert.ok(!log.includes("supersecretvalue"));
  // the record's env only contains explicit doc env
  assert.deepEqual(latest.run.env, { OVERRIDDEN: "explicit" });
  const runsYaml = readFileSync(join(dir, ".testfile", "runs.yaml"), "utf8");
  assert.ok(!runsYaml.includes("supersecretvalue"));
});

test("test-level envFile resolves relative to the test workdir", async () => {
  const dir = tempDir();
  const sub = join(dir, "sub");
  rmSync(sub, { recursive: true, force: true });
  writeFileSync(join(dir, "outer.env"), "WHERE=outer\n");
  const session = new Session(
    {
      version: 1,
      test: {
        sequence: [
          {
            name: "outer",
            envFile: "outer.env",
            command: 'test "$WHERE" = outer',
          },
        ],
      },
    },
    dir
  );
  assert.equal(await session.runAll(), "passed");
});

test("a missing env file fails the run", async () => {
  const dir = tempDir();
  const session = new Session(
    { version: 1, envFile: ".env.missing", test: { command: "true" } },
    dir
  );
  assert.equal(await session.runAll(), "failed");
  assert.match(session.runner!.root.error ?? "", /cannot read env file/);
});
