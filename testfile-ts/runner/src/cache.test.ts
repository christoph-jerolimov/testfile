import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { ResultCache } from "./cache.js";
import { RunHistory } from "./history.js";
import type { TestfileDoc } from "./model.js";
import { Session } from "./session.js";

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "testfile-cache-"));
  process.on("exit", () => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test("inputsHash tracks content and file identity", () => {
  const dir = tempDir();
  mkdirSync(join(dir, "src"));
  writeFileSync(join(dir, "src", "a.ts"), "one");
  const first = ResultCache.inputsHash(dir, ["src/**/*.ts"]);
  assert.equal(ResultCache.inputsHash(dir, ["src/**/*.ts"]), first, "stable across calls");
  writeFileSync(join(dir, "src", "a.ts"), "two");
  const changedContent = ResultCache.inputsHash(dir, ["src/**/*.ts"]);
  assert.notEqual(changedContent, first, "content changes the hash");
  rmSync(join(dir, "src", "a.ts"));
  writeFileSync(join(dir, "src", "b.ts"), "two");
  assert.notEqual(
    ResultCache.inputsHash(dir, ["src/**/*.ts"]),
    changedContent,
    "renames change the hash",
  );
});

test("configKey distinguishes source, env and matrix", () => {
  const base = ResultCache.configKey("p", "npm test", { A: "1" }, {});
  assert.equal(ResultCache.configKey("p", "npm test", { A: "1" }, {}), base);
  assert.notEqual(ResultCache.configKey("p", "npm test -- --grep x", { A: "1" }, {}), base);
  assert.notEqual(ResultCache.configKey("p", "npm test", { A: "2" }, {}), base);
  assert.notEqual(ResultCache.configKey("p", "npm test", { A: "1" }, { db: "pg" }), base);
});

function cachingDoc(): TestfileDoc {
  return {
    version: 0,
    test: {
      name: "unit",
      inputs: ["input.txt"],
      script: "echo ran >> ran.log\ngrep -q good input.txt",
    },
  };
}

test("a passing test with unchanged inputs is served from the cache", async () => {
  const dir = tempDir();
  writeFileSync(join(dir, "input.txt"), "good v1");

  const first = new Session(cachingDoc(), dir);
  assert.equal(await first.runAll(), "passed");
  assert.equal(readFileSync(join(dir, "ran.log"), "utf8"), "ran\n");

  // fresh session, same inputs: cache hit, the script must not run again
  const second = new Session(cachingDoc(), dir);
  assert.equal(await second.runAll(), "passed");
  assert.equal(readFileSync(join(dir, "ran.log"), "utf8"), "ran\n", "script did not re-run");
  const record = second.lastRecord!;
  assert.equal(record.tests.find((t) => t.path === "unit")!.cached, true);

  // changed input: runs again
  writeFileSync(join(dir, "input.txt"), "good v2");
  const third = new Session(cachingDoc(), dir);
  assert.equal(await third.runAll(), "passed");
  assert.equal(readFileSync(join(dir, "ran.log"), "utf8"), "ran\nran\n");
});

test("failures are never cached", async () => {
  const dir = tempDir();
  writeFileSync(join(dir, "input.txt"), "bad");
  const first = new Session(cachingDoc(), dir);
  assert.equal(await first.runAll(), "failed");
  const second = new Session(cachingDoc(), dir);
  assert.equal(await second.runAll(), "failed");
  assert.equal(readFileSync(join(dir, "ran.log"), "utf8"), "ran\nran\n", "failing test re-ran");
});

test("--no-cache ignores entries but refreshes them", async () => {
  const dir = tempDir();
  writeFileSync(join(dir, "input.txt"), "good");
  await new Session(cachingDoc(), dir).runAll();

  const forced = new Session(cachingDoc(), dir, { noCache: true });
  assert.equal(await forced.runAll(), "passed");
  assert.equal(readFileSync(join(dir, "ran.log"), "utf8"), "ran\nran\n", "ran despite the cache");

  // the refreshed entry serves the next cached run
  const after = new Session(cachingDoc(), dir);
  assert.equal(await after.runAll(), "passed");
  assert.equal(readFileSync(join(dir, "ran.log"), "utf8"), "ran\nran\n");
});

test("cache entries survive via cache.json and are gitignored", async () => {
  const dir = tempDir();
  writeFileSync(join(dir, "input.txt"), "good");
  await new Session(cachingDoc(), dir).runAll();
  const stored = JSON.parse(readFileSync(join(dir, ".testfile", "cache.json"), "utf8")) as Record<
    string,
    { hash: string }
  >;
  assert.equal(Object.keys(stored).length, 1);
  assert.match(Object.values(stored)[0].hash, /^1:/);
  assert.equal(readFileSync(join(dir, ".testfile", ".gitignore"), "utf8"), "*\n");
  // history helper still loads fine alongside the cache file
  assert.equal(new RunHistory(dir).runs.length, 1);
});

test("predictCacheHits marks unchanged tests without running them", async () => {
  const { predictCacheHits } = await import("./cache-predict.js");
  const dir = tempDir();
  writeFileSync(join(dir, "input.txt"), "good");
  const doc: TestfileDoc = {
    version: 0,
    test: {
      name: "root",
      sequence: [
        {
          name: "cachable",
          inputs: ["input.txt"],
          script: "echo ran >> ran.log\ngrep -q good input.txt",
        },
        { name: "plain", command: "true" },
      ],
    },
  };
  await new Session(doc, dir).runAll();

  const session = new Session(doc, dir);
  const active = session.activeSetFor([session.suite.id]);
  const before = readFileSync(join(dir, "ran.log"), "utf8");
  const hits = await predictCacheHits(session, active);
  assert.equal(
    readFileSync(join(dir, "ran.log"), "utf8"),
    before,
    "prediction must not execute anything",
  );
  assert.equal(hits.size, 1);
  const hitNode = session.byId.get([...hits][0])!;
  assert.equal(hitNode.name, "cachable");

  // change the input: no longer predicted as a hit
  writeFileSync(join(dir, "input.txt"), "good v2");
  const after = await predictCacheHits(session, active);
  assert.equal(after.size, 0);

  // --no-cache sessions predict nothing
  const forced = new Session(doc, dir, { noCache: true });
  assert.equal((await predictCacheHits(forced, forced.activeSetFor([forced.suite.id]))).size, 0);
});

test("gitChangedSelection picks tests whose inputs match changed files", async () => {
  const { gitChangedSelection } = await import("./cache-predict.js");
  const dir = tempDir();
  writeFileSync(join(dir, "input.txt"), "good");
  const doc: TestfileDoc = {
    version: 0,
    test: {
      name: "root",
      sequence: [
        { name: "cachable", inputs: ["input.txt"], command: "grep -q good input.txt" },
        { name: "plain", command: "true" },
      ],
    },
  };
  const session = new Session(doc, dir);
  const active = session.activeSetFor([session.suite.id]);
  const base = { gitRoot: dir, baseRef: "origin/main", baseCommit: "abc", headCommit: "def" };

  const miss = await gitChangedSelection(session, active, {
    ...base,
    files: [{ path: "other.txt", source: "diff" as const, status: "modified" as const }],
  });
  assert.deepEqual(
    miss.ids.map((id) => session.byId.get(id)!.name),
    ["plain"],
    "no matching input: only inputs-less tests count as changed",
  );

  const hit = await gitChangedSelection(session, active, {
    ...base,
    files: [{ path: "input.txt", source: "local" as const, status: "modified" as const }],
  });
  assert.deepEqual(hit.ids.map((id) => session.byId.get(id)!.name).sort(), ["cachable", "plain"]);
  const cachableId = hit.ids.find((id) => session.byId.get(id)!.name === "cachable")!;
  const note = hit.notes.get(cachableId)!;
  assert.match(note, /selected by --changed against origin\/main/);
  assert.match(note, /input\.txt: 1 changed file \(input\.txt\)/);
  assert.equal(hit.notes.has(hit.ids.find((id) => session.byId.get(id)!.name === "plain")!), false);
});

test("a cache miss and its cause are recorded as the test's reason", async () => {
  const dir = tempDir();
  writeFileSync(join(dir, "input.txt"), "good v1");

  const first = new Session(cachingDoc(), dir);
  await first.runAll();
  const firstReason = first.lastRecord!.tests.find((t) => t.path === "unit")!.reason!;
  assert.match(firstReason, /cache miss: no stored passing result/);

  const second = new Session(cachingDoc(), dir);
  await second.runAll();
  const hitReason = second.lastRecord!.tests.find((t) => t.path === "unit")!.reason!;
  assert.match(hitReason, /cache hit: inputs unchanged/);

  writeFileSync(join(dir, "input.txt"), "good v2");
  const third = new Session(cachingDoc(), dir);
  await third.runAll();
  const missReason = third.lastRecord!.tests.find((t) => t.path === "unit")!.reason!;
  assert.match(missReason, /cache miss: input\.txt: 1 changed file \(input\.txt\)/);
});
