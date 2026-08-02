import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Runner } from "./executor.js";
import type { TestfileDoc } from "./model.js";
import { buildRunTree, type RunNode } from "./runtree.js";

function makeRunner(doc: TestfileDoc, options: ConstructorParameters<typeof Runner>[3] = {}): Runner {
  return new Runner(doc, buildRunTree(doc), process.cwd(), options);
}

test("a passing command", async () => {
  const runner = makeRunner({ version: 0, test: { command: "true" } });
  assert.equal(await runner.run(), "passed");
});

test("a failing command fails with its exit code", async () => {
  const runner = makeRunner({ version: 0, test: { command: "exit 3" } });
  assert.equal(await runner.run(), "failed");
  assert.match(runner.root.error ?? "", /exit code 3/);
});

test("sequence stops at the first failure and skips the rest", async () => {
  const runner = makeRunner({
    version: 0,
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
    version: 0,
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
    version: 0,
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
    version: 0,
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
    version: 0,
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
    version: 0,
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
    version: 0,
    test: { command: "sleep 10", timeout: "300ms" },
  });
  assert.equal(await runner.run(), "failed");
  assert.match(runner.root.error ?? "", /timeout/);
});

test("services start, become ready via log match, and are stopped", async () => {
  const runner = makeRunner({
    version: 0,
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

test("an exec readiness check polls a command until it exits 0", async () => {
  const dir = mkdtempSync(join(tmpdir(), "testfile-exec-ready-"));
  process.on("exit", () => rmSync(dir, { recursive: true, force: true }));
  const runner = makeRunner({
    version: 0,
    env: { DIR: dir },
    services: {
      slowstart: {
        // the flag appears only after 300ms; exec-ready must wait for it
        script: 'sleep 0.3\ntouch "$DIR/up"\nsleep 30',
        ready: { exec: 'test -f "$DIR/up"', interval: "100ms", timeout: "5s" },
      },
    },
    test: { command: 'test -f "$DIR/up"' },
  });
  assert.equal(await runner.run(), "passed");
  assert.equal(runner.services[0].status, "stopped");
});

test("an exec check that never succeeds fails the run at the timeout", async () => {
  const runner = makeRunner({
    version: 0,
    services: {
      never: {
        script: "sleep 30",
        ready: { exec: "false", interval: "100ms", timeout: "500ms" },
      },
    },
    test: { command: "true" },
  });
  assert.equal(await runner.run(), "failed");
  assert.match(runner.services[0].error ?? "", /not ready/);
});

test("a service that dies before readiness fails the run", async () => {
  const runner = makeRunner({
    version: 0,
    services: {
      dead: { command: "false", ready: { log: "never", interval: "100ms", timeout: "3s" } },
    },
    test: { command: "true" },
  });
  assert.equal(await runner.run(), "failed");
  assert.equal(runner.services[0].status, "failed");
});

test("a shared service starts once for identical matrix instances", async () => {
  const runner = makeRunner({
    version: 0,
    test: {
      name: "m",
      matrix: { v: ["a", "b", "c"] },
      services: {
        db: {
          shared: true,
          script: "echo up\nsleep 30",
          ready: { log: "up", interval: "100ms" },
        },
      },
      command: "true",
    },
  });
  assert.equal(await runner.run(), "passed");
  assert.equal(runner.services.length, 1, "one instance for all three matrix instances");
  assert.equal(runner.services[0].status, "stopped");
  assert.match(runner.services[0].owner, /shared/);
});

test("a shared service with a matrix-dependent config gets one instance per config", async () => {
  const runner = makeRunner({
    version: 0,
    test: {
      name: "m",
      matrix: { v: ["a", "b"] },
      services: {
        db: {
          shared: true,
          env: { VARIANT: "${{ matrix.v }}" },
          script: "echo up variant=$VARIANT\nsleep 30",
          ready: { log: "up", interval: "100ms" },
        },
      },
      command: "true",
    },
  });
  assert.equal(await runner.run(), "passed");
  assert.equal(runner.services.length, 2, "different resolved configs must not share");
  const variants = runner.services.map((s) => s.output.text()).sort();
  assert.match(variants[0], /variant=a/);
  assert.match(variants[1], /variant=b/);
  assert.ok(runner.services.every((s) => s.status === "stopped"));
});

test("without shared, every matrix instance starts its own service", async () => {
  const runner = makeRunner({
    version: 0,
    test: {
      name: "m",
      matrix: { v: ["a", "b"] },
      services: {
        db: { script: "echo up\nsleep 30", ready: { log: "up", interval: "100ms" } },
      },
      command: "true",
    },
  });
  assert.equal(await runner.run(), "passed");
  assert.equal(runner.services.length, 2);
});

test("test-scoped services stop when the subtree finishes", async () => {
  const runner = makeRunner({
    version: 0,
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

test("needs orders parallel children and runs dependents after dependencies", async () => {
  const runner = makeRunner({
    version: 0,
    test: {
      parallel: [
        { name: "late-start", needs: ["slow"], command: "true" },
        { name: "slow", script: "sleep 0.3" },
      ],
    },
  });
  assert.equal(await runner.run(), "passed");
  const [dependent, dependency] = runner.root.children;
  assert.equal(dependent.name, "late-start");
  assert.ok(
    dependent.startedAt! >= dependency.endedAt!,
    "dependent must start after its dependency finished"
  );
});

test("a failing dependency skips its dependents but not unrelated siblings", async () => {
  const runner = makeRunner({
    version: 0,
    test: {
      parallel: [
        { name: "broken", command: "false" },
        { name: "dependent", needs: ["broken"], command: "true" },
        { name: "chained", needs: ["dependent"], command: "true" },
        { name: "unrelated", command: "true" },
      ],
    },
  });
  assert.equal(await runner.run(), "failed");
  const byName = new Map(runner.root.children.map((c: RunNode) => [c.name, c]));
  assert.equal(byName.get("broken")!.status, "failed");
  assert.equal(byName.get("dependent")!.status, "skipped");
  assert.equal(byName.get("chained")!.status, "skipped");
  assert.equal(byName.get("unrelated")!.status, "passed");
});

test("a skipped (condition) dependency does not block its dependents", async () => {
  const runner = makeRunner({
    version: 0,
    test: {
      parallel: [
        { name: "optional", if: "false", command: "false" },
        { name: "dependent", needs: ["optional"], command: "true" },
      ],
    },
  });
  assert.equal(await runner.run(), "passed");
  assert.equal(runner.root.children[1].status, "passed");
});

test("a false if condition skips the test without failing the sequence", async () => {
  const runner = makeRunner({
    version: 0,
    test: {
      sequence: [
        { name: "skipped", if: "${{ env.TESTFILE_NOT_SET }}", command: "false" },
        { name: "runs", command: "true" },
      ],
    },
  });
  assert.equal(await runner.run(), "passed");
  assert.equal(runner.root.children[0].status, "skipped");
  assert.equal(runner.root.children[1].status, "passed");
});

test("if conditions see platform facts and matrix values", async () => {
  const runner = makeRunner({
    version: 0,
    test: {
      name: "m",
      matrix: { db: ["postgres", "mysql"] },
      if: "${{ matrix.db }} == postgres",
      command: "true",
    },
  });
  assert.equal(await runner.run(), "passed");
  assert.equal(runner.root.children[0].status, "passed");
  assert.equal(runner.root.children[1].status, "skipped");

  const platform = makeRunner({
    version: 0,
    test: { if: `\${{ env.TESTFILE_OS }} == ${process.platform}`, command: "true" },
  });
  assert.equal(await platform.run(), "passed");
});

test("a group whose children all skip is reported as skipped", async () => {
  const runner = makeRunner({
    version: 0,
    test: {
      sequence: [{ name: "a", if: "false", command: "true" }],
    },
  });
  assert.equal(await runner.run(), "skipped");
});

test("a custom shell runs commands and scripts via -c", async () => {
  const runner = makeRunner({
    version: 0,
    test: {
      sequence: [
        { name: "bashism", shell: "bash", command: "[[ 1 -eq 1 ]]" },
        { name: "python", shell: "python3", command: "import sys; sys.exit(0)" },
        { name: "bash strict", shell: "bash -e", script: "true\n[[ -n ok ]]" },
      ],
    },
  });
  assert.equal(await runner.run(), "passed");
});

test("a failing custom-shell test reports its exit code", async () => {
  const runner = makeRunner({
    version: 0,
    test: { shell: "python3", command: "import sys; sys.exit(7)" },
  });
  assert.equal(await runner.run(), "failed");
  assert.match(runner.root.error ?? "", /exit code 7/);
});

test("retry re-runs a flaky command until it passes", async () => {
  const dir = mkdtempSync(join(tmpdir(), "testfile-retry-"));
  process.on("exit", () => rmSync(dir, { recursive: true, force: true }));
  const runner = makeRunner({
    version: 0,
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
    version: 0,
    test: { retry: { count: 2, delay: "100ms" }, command: "false" },
  });
  assert.equal(await runner.run(), "failed");
  assert.match(runner.root.error ?? "", /after 3 attempts/);
  const retries = runner.root.output.lines.filter((l) => l.text.includes("failed, retrying"));
  assert.equal(retries.length, 2);
});

test("retry does not re-run a passing command", async () => {
  const runner = makeRunner({
    version: 0,
    test: { retry: 5, command: "true" },
  });
  assert.equal(await runner.run(), "passed");
  assert.equal(runner.root.output.lines.filter((l) => l.text.includes("retrying")).length, 0);
});

test("failFast aborts the rest of the run at the first failure", async () => {
  const runner = makeRunner(
    {
      version: 0,
      test: {
        parallel: [
          { name: "fails-quickly", command: "false" },
          { name: "slow", script: "sleep 5" },
          { name: "queued", needs: ["slow"], command: "true" },
        ],
      },
    },
    { failFast: true }
  );
  const startedAt = Date.now();
  assert.equal(await runner.run(), "failed");
  assert.ok(Date.now() - startedAt < 4000, "slow sibling must be aborted, not awaited");
  const byName = new Map(runner.root.children.map((c: RunNode) => [c.name, c]));
  assert.equal(byName.get("fails-quickly")!.status, "failed");
  assert.equal(byName.get("slow")!.status, "aborted");
  assert.equal(runner.interrupted, false, "fail-fast is not an interrupt");
});

test("a global maxParallel caps concurrency across groups", async () => {
  const runner = makeRunner(
    {
      version: 0,
      test: {
        parallel: [
          { name: "a", script: "sleep 0.3" },
          { name: "b", script: "sleep 0.3" },
          { name: "c", script: "sleep 0.3" },
        ],
      },
    },
    { maxParallel: 1 }
  );
  const startedAt = Date.now();
  assert.equal(await runner.run(), "passed");
  assert.ok(Date.now() - startedAt >= 850, "three 300ms sleeps with maxParallel 1 must serialize");
});

test("setup runs before the body and teardown after it", async () => {
  const runner = makeRunner({
    version: 0,
    test: {
      setup: { command: "echo setup-ran" },
      teardown: { command: "echo teardown-ran" },
      command: "echo body-ran",
    },
  });
  assert.equal(await runner.run(), "passed");
  const texts = runner.root.output.lines.filter((l) => l.stream === "stdout").map((l) => l.text);
  assert.deepEqual(texts, ["setup-ran", "body-ran", "teardown-ran"]);
});

test("a failing setup skips the body but still runs teardown", async () => {
  const runner = makeRunner({
    version: 0,
    test: {
      setup: { command: "false" },
      teardown: { command: "echo teardown-ran" },
      sequence: [{ name: "child", command: "echo child-ran" }],
    },
  });
  assert.equal(await runner.run(), "failed");
  assert.equal(runner.root.error, "setup failed");
  assert.equal(runner.root.children[0].status, "skipped");
  const texts = runner.root.output.lines.map((l) => l.text);
  assert.ok(texts.includes("teardown-ran"));
  assert.ok(!texts.includes("child-ran"));
});

test("a failing teardown fails an otherwise passing test", async () => {
  const runner = makeRunner({
    version: 0,
    test: { teardown: { script: "echo cleaning\nfalse" }, command: "true" },
  });
  assert.equal(await runner.run(), "failed");
  assert.equal(runner.root.error, "teardown failed");
});

test("teardown runs on body failure and keeps the original error", async () => {
  const runner = makeRunner({
    version: 0,
    test: { teardown: { command: "echo teardown-ran" }, command: "exit 7" },
  });
  assert.equal(await runner.run(), "failed");
  assert.match(runner.root.error ?? "", /exit code 7/);
  assert.ok(runner.root.output.lines.some((l) => l.text === "teardown-ran"));
});

test("hook env and timeout are honored", async () => {
  const runner = makeRunner({
    version: 0,
    env: { OUTER: "o" },
    test: {
      setup: { command: 'test "$OUTER" = o && test "$INNER" = i', env: { INNER: "i" } },
      command: "true",
    },
  });
  assert.equal(await runner.run(), "passed");

  const slow = makeRunner({
    version: 0,
    test: { setup: { command: "sleep 10", timeout: "300ms" }, command: "true" },
  });
  assert.equal(await slow.run(), "failed");
  assert.equal(slow.root.error, "setup failed");
});

test("requestStop aborts the run gracefully", async () => {
  const runner = makeRunner({
    version: 0,
    test: { sequence: [{ command: "sleep 10" }, { command: "true" }] },
  });
  const done = runner.run();
  setTimeout(() => runner.requestStop(), 300);
  const status = await done;
  assert.equal(status, "aborted");
  assert.equal(runner.interrupted, true);
  assert.equal(runner.root.children[1].status, "aborted");
});

test("host env does not leak into tests; essentials, CI=1 and color do", async () => {
  process.env.TESTFILE_LEAKY_SECRET = "oops";
  try {
    const runner = makeRunner({
      version: 0,
      test: {
        sequence: [
          { name: "no-leak", command: 'test -z "$TESTFILE_LEAKY_SECRET"' },
          { name: "path", command: 'test -n "$PATH" && test -n "$HOME"' },
          { name: "ci", command: 'test "$CI" = "1"' },
          { name: "color", command: 'test "$FORCE_COLOR" = "1"' },
        ],
      },
    });
    assert.equal(await runner.run(), "passed");
  } finally {
    delete process.env.TESTFILE_LEAKY_SECRET;
  }
});

test("forwardEnv patterns forward matching host vars, doc env still wins", async () => {
  process.env.TESTFILE_FWD_ONE = "one";
  process.env.TESTFILE_FWD_TWO = "two";
  process.env.TESTFILE_OTHER = "other";
  try {
    const runner = makeRunner({
      version: 0,
      forwardEnv: ["TESTFILE_FWD_*"],
      env: { TESTFILE_FWD_TWO: "overridden" },
      test: {
        sequence: [
          { name: "match", command: 'test "$TESTFILE_FWD_ONE" = "one"' },
          { name: "doc-env-wins", command: 'test "$TESTFILE_FWD_TWO" = "overridden"' },
          { name: "no-match", command: 'test -z "$TESTFILE_OTHER"' },
        ],
      },
    });
    assert.equal(await runner.run(), "passed");
  } finally {
    delete process.env.TESTFILE_FWD_ONE;
    delete process.env.TESTFILE_FWD_TWO;
    delete process.env.TESTFILE_OTHER;
  }
});

test("per-test forwardEnv applies to the subtree only; * forwards everything", async () => {
  process.env.TESTFILE_SUBTREE_VAR = "sub";
  try {
    const runner = makeRunner({
      version: 0,
      test: {
        sequence: [
          { name: "isolated", command: 'test -z "$TESTFILE_SUBTREE_VAR"' },
          {
            name: "group",
            forwardEnv: ["TESTFILE_SUBTREE_*"],
            sequence: [{ name: "inherited", command: 'test "$TESTFILE_SUBTREE_VAR" = "sub"' }],
          },
          { name: "star", forwardEnv: ["*"], command: 'test "$TESTFILE_SUBTREE_VAR" = "sub"' },
        ],
      },
    });
    assert.equal(await runner.run(), "passed");
  } finally {
    delete process.env.TESTFILE_SUBTREE_VAR;
  }
});

test("--forward-env (runner option) forwards like the document field", async () => {
  process.env.TESTFILE_CLI_FWD = "cli";
  try {
    const runner = makeRunner(
      { version: 0, test: { command: 'test "$TESTFILE_CLI_FWD" = "cli"' } },
      { forwardEnv: ["TESTFILE_CLI_*"] }
    );
    assert.equal(await runner.run(), "passed");
  } finally {
    delete process.env.TESTFILE_CLI_FWD;
  }
});
