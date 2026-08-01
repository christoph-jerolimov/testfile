import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { parse } from "yaml";
import { RunHistory } from "./history.js";
import type { TestfileDoc } from "./model.js";
import { walk, type RunNode } from "./runtree.js";
import { Session } from "./session.js";

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "testfile-"));
  process.on("exit", () => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

const doc: TestfileDoc = {
  version: 1,
  env: { GREETING: "hi" },
  test: {
    name: "root",
    sequence: [
      { name: "one", command: "echo one-out" },
      { name: "two", command: "echo two-err >&2; false", continueOnError: true },
    ],
  },
};

test("a run is persisted with its own run.yaml, env, per-test logs and merged output", async () => {
  const dir = tempDir();
  const session = new Session(doc, dir);
  const status = await session.runAll();
  assert.equal(status, "passed");

  const runId = session.lastRecord!.id;
  const run = parse(readFileSync(join(dir, ".testfile", "runs", runId, "run.yaml"), "utf8"));
  assert.equal(run.id, runId);
  assert.equal(run.status, "passed");
  assert.equal(run.exitCode, 0);
  assert.equal(run.cancelled, false);
  assert.equal(run.env.GREETING, "hi");
  assert.deepEqual(run.selected, ["root"]);
  assert.ok(run.durationMs >= 0);
  assert.ok(run.tests.some((t: { path: string }) => t.path === "root/one"));
  assert.equal(run.tests.find((t: { path: string }) => t.path === "root/two").status, "failed");

  // per-test log via a fresh RunHistory (round-trips through the files)
  const history = new RunHistory(dir);
  const latest = history.latestFor("root/one");
  assert.ok(latest);
  assert.match(history.readLog(latest.run, latest.test) ?? "", /one-out/);
  const latestTwo = history.latestFor("root/two");
  assert.match(history.readLog(latestTwo!.run, latestTwo!.test) ?? "", /two-err/);

  // merged run log
  const merged = readFileSync(join(dir, ".testfile", "runs", run.id, "output.log"), "utf8");
  assert.match(merged, /=== root\/one \(passed/);
  assert.match(merged, /one-out/);

  // the folder ignores itself
  assert.equal(readFileSync(join(dir, ".testfile", ".gitignore"), "utf8"), "*\n");
});

test("artifacts are collected into the run folder and recorded", async () => {
  const dir = tempDir();
  const session = new Session(
    {
      version: 1,
      test: {
        name: "produce",
        artifacts: ["out/**/*.txt"],
        script: "mkdir -p out/nested\necho hello > out/a.txt\necho deep > out/nested/b.txt\necho ignored > out/c.log",
      },
    },
    dir
  );
  assert.equal(await session.runAll(), "passed");
  const record = session.lastRecord!;
  const entry = record.tests.find((t) => t.path === "produce")!;
  assert.equal(entry.artifacts?.length, 2);
  const runDir = join(dir, ".testfile", "runs", record.id);
  for (const artifact of entry.artifacts!) {
    assert.ok(existsSync(join(runDir, artifact)), artifact);
  }
  assert.ok(entry.artifacts!.some((a) => a.endsWith("a.txt")));
  assert.ok(entry.artifacts!.some((a) => a.endsWith(join("nested", "b.txt"))));
  assert.ok(!entry.artifacts!.some((a) => a.endsWith("c.log")));
});

test("artifacts are collected from failing tests too", async () => {
  const dir = tempDir();
  const session = new Session(
    {
      version: 1,
      test: { name: "fails", artifacts: ["report.txt"], script: "echo partial > report.txt\nfalse" },
    },
    dir
  );
  assert.equal(await session.runAll(), "failed");
  const entry = session.lastRecord!.tests.find((t) => t.path === "fails")!;
  assert.equal(entry.artifacts?.length, 1);
});

test("runs can be found by id prefix and their merged log read back", async () => {
  const dir = tempDir();
  const session = new Session(doc, dir);
  await session.runAll();
  const id = session.lastRecord!.id;
  const history = new RunHistory(dir);
  assert.equal(history.find(id)?.id, id);
  assert.equal(history.find(id.slice(0, 15))?.id, id, "unique prefix matches");
  assert.equal(history.find("nope"), undefined);
  const merged = history.readRunLog(history.find(id)!) ?? "";
  assert.match(merged, /=== root\/one \(passed/);
  assert.match(merged, /one-out/);
});

test("newer runs are prepended and become the latest result", async () => {
  const dir = tempDir();
  const session = new Session(doc, dir);
  await session.runAll();
  const firstId = session.lastRecord!.id;
  await session.runAll();
  const history = new RunHistory(dir);
  assert.equal(history.runs.length, 2);
  assert.notEqual(history.runs[0].id, firstId);
  assert.equal(history.latestFor("root/one")!.run.id, history.runs[0].id);
});

test("runSelected only runs the selected subtree, the rest stays untouched", async () => {
  const dir = tempDir();
  const session = new Session(doc, dir);
  let two: RunNode | undefined;
  walk(session.tree, (node) => {
    if (node.name === "two") two = node;
  });
  const status = await session.runSelected([two!.id]);
  assert.equal(status, "passed");
  const byName = new Map<string, RunNode>();
  walk(session.tree, (node) => byName.set(node.name, node));
  assert.equal(byName.get("one")!.status, "pending");
  assert.equal(byName.get("two")!.status, "failed");
  assert.equal(byName.get("root")!.status, "passed");
  // only the tests that ran are recorded
  const paths = session.lastRecord!.tests.map((t) => t.path);
  assert.deepEqual(paths.sort(), ["root", "root/two"]);
  assert.deepEqual(session.lastRecord!.selected, ["root/two"]);
});

test("running with an empty selection does nothing", async () => {
  const dir = tempDir();
  const session = new Session(doc, dir);
  assert.equal(await session.runSelected([]), undefined);
  assert.equal(session.lastRecord, undefined);
  assert.equal(existsSync(join(dir, ".testfile")), false);
});

test("a cancelled run is recorded as cancelled with exit code 130", async () => {
  const dir = tempDir();
  const session = new Session(
    { version: 1, test: { name: "slow", command: "sleep 10" } },
    dir
  );
  const done = session.runAll();
  setTimeout(() => session.runner?.requestStop(), 300);
  await done;
  const run = new RunHistory(dir).runs[0];
  assert.equal(run.cancelled, true);
  assert.equal(run.status, "aborted");
  assert.equal(run.exitCode, 130);
});

test("nodes can run again after a selective re-run resets them", async () => {
  const dir = tempDir();
  const session = new Session(doc, dir);
  await session.runAll();
  let one: RunNode | undefined;
  walk(session.tree, (node) => {
    if (node.name === "one") one = node;
  });
  assert.equal(one!.status, "passed");
  await session.runSelected([one!.id]);
  assert.equal(one!.status, "passed");
  assert.equal(new RunHistory(dir).runs.length, 2);
});
