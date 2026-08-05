import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { loadTestfile } from "./loader.js";
import type { TestfileDoc } from "./model.js";
import { Session } from "./session.js";
import { collectTags, sortTags } from "./tags.js";

function suiteFor(doc: TestfileDoc) {
  return new Session(doc, ".").suite;
}

test("collectTags counts inherited tags on leaves and untagged tests", () => {
  const summary = collectTags(
    suiteFor({
      version: 0,
      test: {
        name: "root",
        sequence: [
          { name: "a", tags: ["fast"], command: "true" },
          {
            name: "group",
            tags: ["slow", "nightly"],
            sequence: [
              { name: "b", command: "true" },
              { name: "c", tags: ["fast"], command: "true" },
            ],
          },
          { name: "d", command: "true" },
        ],
      },
    }),
  );

  assert.equal(summary.tests, 4);
  assert.equal(summary.untagged, 1, "only d has no tags");
  assert.deepEqual(
    summary.tags.map(({ name, count, appearance }) => `${appearance}:${name}=${count}`),
    ["0:fast=2", "1:slow=2", "2:nightly=2"],
    "appearance follows document order; group tags count for every nested leaf",
  );
});

test("collectTags counts every matrix instance", () => {
  const summary = collectTags(
    suiteFor({
      version: 0,
      test: {
        name: "root",
        sequence: [
          {
            name: "db ${{ matrix.db }}",
            tags: ["db"],
            matrix: { db: ["postgres", "mysql"] },
            command: "true",
          },
        ],
      },
    }),
  );
  assert.deepEqual(summary.tags, [{ name: "db", appearance: 0, count: 2 }]);
  assert.equal(summary.tests, 2);
  assert.equal(summary.untagged, 0);
});

test("tags from included Testfiles are part of the inventory", () => {
  const dir = mkdtempSync(join(tmpdir(), "testfile-tags-"));
  process.on("exit", () => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(
    join(dir, "child.yaml"),
    ["version: 0", "test:", "  name: child", "  tags: [included]", "  command: 'true'"].join("\n"),
  );
  writeFileSync(
    join(dir, "Testfile"),
    [
      "version: 0",
      "test:",
      "  name: all",
      "  sequence:",
      "    - name: own",
      "      tags: [local]",
      "      command: 'true'",
      "    - name: sub",
      "      include: child.yaml",
    ].join("\n"),
  );

  const { doc } = loadTestfile(dir);
  const summary = collectTags(new Session(doc, dir).suite);
  assert.deepEqual(summary.tags.map((tag) => `${tag.name}=${tag.count}`).sort(), [
    "included=1",
    "local=1",
  ]);
});

test("sortTags orders alphabetically, by appearance or by count", () => {
  const tags = [
    { name: "zeta", appearance: 0, count: 1 },
    { name: "alpha", appearance: 1, count: 3 },
    { name: "mid", appearance: 2, count: 3 },
  ];
  assert.deepEqual(
    sortTags(tags, "alpha").map((t) => t.name),
    ["alpha", "mid", "zeta"],
  );
  assert.deepEqual(
    sortTags(tags, "appearance").map((t) => t.name),
    ["zeta", "alpha", "mid"],
  );
  assert.deepEqual(
    sortTags(tags, "count").map((t) => t.name),
    ["alpha", "mid", "zeta"],
    "count descending, ties alphabetical",
  );
});
