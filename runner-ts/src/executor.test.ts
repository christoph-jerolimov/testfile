import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Runner } from "./executor.js";
import type { TestfileDoc } from "./model.js";
import { buildRunTree, type RunNode } from "./runtree.js";

function makeRunner(doc: TestfileDoc): Runner {
  return new Runner(doc, buildRunTree(doc), process.cwd());
}

test("a passing command", async () => {
  const runner = makeRunner({ version: 1, test: { command: "true" } });
  assert.equal(await runner.run(), "passed");
});

test("a failing command fails with its exit code", async () => {
  const runner = makeRunner({ version: 1, test: { command: "exit 3" } });
  assert.equal(await runner.run(), "failed");
  assert.match(runner.root.error ?? "", /exit code 3/);
});

test("sequence stops at the first failure and skips the rest", async () => {
  const runner = makeRunner({
    version: 1,
    test: {
      sequence: [{ command: "true" }, { command: "false" }, { command: "true" }],
    },
  });
  assert.equal(await runner.run(), "failed");
  const [a, b, c] = runner.root.children;
  assert.equal(a.status, "passed");
  assert.equal(b.status, "failed");
  assert.equal(c.status, "skipped");
});

test("continueOnError keeps a sequence going and the parent green", async () => {
  const runner = makeRunner({
    version: 1,
    test: {
      sequence: [{ command: "false", continueOnError: true }, { command: "true" }],
    },
  });
  assert.equal(await runner.run(), "passed");
  assert.equal(runner.root.children[0].status, "failed");
  assert.equal(runner.root.children[1].status, "passed");
});

test("parallel runs all children and aggregates failures", async () => {
  const runner = makeRunner({
    version: 1,
    test: {
      parallel: [{ command: "true" }, { command: "false" }, { command: "true" }],
      maxParallel: 2,
    },
  });
  assert.equal(await runner.run(), "failed");
  const statuses = runner.root.children.map((c: RunNode) => c.status);
  assert.deepEqual(statuses, ["passed", "failed", "passed"]);
});

test("matrix expands and exposes values as template and env", async () => {
  const runner = makeRunner({
    version: 1,
    test: {
      name: "m",
      matrix: { v: ["a", "b"] },
      command: 'test "${{ matrix.v }}" = "$TESTFILE_MATRIX_V"',
    },
  });
  assert.equal(await runner.run(), "passed");
  assert.equal(runner.root.isMatrixWrapper, true);
  assert.equal(runner.root.children.length, 2);
  assert.equal(runner.root.children[0].name, "m (v=a)");
});

test("env is merged child-over-parent and templates resolve", async () => {
  const runner = makeRunner({
    version: 1,
    env: { FOO: "root", BAR: "bar" },
    test: {
      env: { FOO: "child" },
      script: 'test "$FOO" = child\ntest "$BAR" = bar',
    },
  });
  assert.equal(await runner.run(), "passed");
});

test("random ports resolve in templates", async () => {
  const runner = makeRunner({
    version: 1,
    ports: { web: "random" },
    test: {
      env: { PORT: "${{ ports.web }}" },
      command: 'test "$PORT" -gt 0',
    },
  });
  assert.equal(await runner.run(), "passed");
  assert.ok(runner.ports.web > 0);
});

test("a timeout fails the test", async () => {
  const runner = makeRunner({
    version: 1,
    test: { command: "sleep 10", timeout: "300ms" },
  });
  assert.equal(await runner.run(), "failed");
  assert.match(runner.root.error ?? "", /timeout/);
});

test("services start, become ready via log match, and are stopped", async () => {
  const runner = makeRunner({
    version: 1,
    services: {
      fake: {
        script: "echo started\nsleep 30",
        ready: { log: "started", interval: "100ms", timeout: "5s" },
      },
    },
    test: { command: "true" },
  });
  assert.equal(await runner.run(), "passed");
  assert.equal(runner.services.length, 1);
  assert.equal(runner.services[0].status, "stopped");
});

test("a service that dies before readiness fails the run", async () => {
  const runner = makeRunner({
    version: 1,
    services: {
      dead: { command: "false", ready: { log: "never", interval: "100ms", timeout: "3s" } },
    },
    test: { command: "true" },
  });
  assert.equal(await runner.run(), "failed");
  assert.equal(runner.services[0].status, "failed");
});

test("test-scoped services stop when the subtree finishes", async () => {
  const runner = makeRunner({
    version: 1,
    test: {
      sequence: [
        {
          name: "with service",
          services: {
            scoped: { script: "echo up\nsleep 30", ready: { log: "up", interval: "100ms" } },
          },
          command: "true",
        },
        { command: "true" },
      ],
    },
  });
  assert.equal(await runner.run(), "passed");
  assert.equal(runner.services.length, 1);
  assert.equal(runner.services[0].owner, "with service");
  assert.equal(runner.services[0].status, "stopped");
});

test("retry re-runs a flaky command until it passes", async () => {
  const dir = mkdtempSync(join(tmpdir(), "testfile-retry-"));
  process.on("exit", () => rmSync(dir, { recursive: true, force: true }));
  const runner = makeRunner({
    version: 1,
    test: {
      workdir: dir,
      retry: 2,
      // fails on the first attempt, passes on the second
      command: "test -f flag || { touch flag; exit 1; }",
    },
  });
  assert.equal(await runner.run(), "passed");
  assert.ok(runner.root.output.lines.some((l) => l.text.includes("attempt 1/3 failed")));
});

test("retry gives up after the configured attempts", async () => {
  const runner = makeRunner({
    version: 1,
    test: { retry: { count: 2, delay: "100ms" }, command: "false" },
  });
  assert.equal(await runner.run(), "failed");
  assert.match(runner.root.error ?? "", /after 3 attempts/);
  const retries = runner.root.output.lines.filter((l) => l.text.includes("failed, retrying"));
  assert.equal(retries.length, 2);
});

test("retry does not re-run a passing command", async () => {
  const runner = makeRunner({
    version: 1,
    test: { retry: 5, command: "true" },
  });
  assert.equal(await runner.run(), "passed");
  assert.equal(runner.root.output.lines.filter((l) => l.text.includes("retrying")).length, 0);
});

test("requestStop aborts the run gracefully", async () => {
  const runner = makeRunner({
    version: 1,
    test: { sequence: [{ command: "sleep 10" }, { command: "true" }] },
  });
  const done = runner.run();
  setTimeout(() => runner.requestStop(), 300);
  const status = await done;
  assert.equal(status, "aborted");
  assert.equal(runner.interrupted, true);
  assert.equal(runner.root.children[1].status, "aborted");
});
