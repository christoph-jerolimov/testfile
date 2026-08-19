// The Tekton Task mirrors the GitHub Action, but nothing in CI can apply
// it to a cluster - so its shape is pinned here instead: the manifests
// parse, every $(params.x) and $(results.x.path) a step uses is declared,
// every declared parameter is actually used and documented, and the
// example pipeline passes only parameters the Task has. A renamed
// parameter cannot quietly leave a dangling reference behind.
import assert from "node:assert/strict";
import { test } from "node:test";
import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
// the yaml dependency of the runner workspace, hoisted to the root
const require = createRequire(join(root, "testfile-ts", "runner", "package.json"));
const { parseAllDocuments } = require("yaml");

const tektonDir = join(root, "tekton");
const files = readdirSync(tektonDir)
  .filter((f) => f.endsWith(".yaml"))
  .sort();

function docsOf(file) {
  const text = readFileSync(join(tektonDir, file), "utf8");
  return parseAllDocuments(text).map((doc) => {
    assert.equal(doc.errors.length, 0, `${file}: ${doc.errors[0]}`);
    return doc.toJS();
  });
}

const manifests = new Map(files.map((f) => [f, docsOf(f)]));

test("every manifest is a named Kubernetes object", () => {
  assert.ok(files.length >= 3, `expected the task, pipeline and rbac files, found ${files}`);
  for (const [file, docs] of manifests) {
    assert.ok(docs.length > 0, `${file} holds no documents`);
    for (const doc of docs) {
      assert.ok(doc.apiVersion, `${file}: a document without apiVersion`);
      assert.ok(doc.kind, `${file}: a document without kind`);
      assert.ok(doc.metadata?.name, `${file}: a document without metadata.name`);
    }
  }
});

const task = manifests.get("testfile-task.yaml")[0];
const taskText = readFileSync(join(tektonDir, "testfile-task.yaml"), "utf8");
const params = new Map(task.spec.params.map((p) => [p.name, p.type ?? "string"]));
const results = new Set(task.spec.results.map((r) => r.name));

test("every $(params.x) the task uses is declared, and vice versa", () => {
  const used = new Set(
    [...taskText.matchAll(/\$\(params\.([a-z-]+)(?:\[\*\])?\)/g)].map((m) => m[1]),
  );
  for (const name of used) assert.ok(params.has(name), `$(params.${name}) is not declared`);
  for (const name of params.keys()) assert.ok(used.has(name), `parameter "${name}" is never used`);
});

test("array parameters are consumed as arrays, strings never are", () => {
  for (const [name, type] of params) {
    const asArray = taskText.includes(`$(params.${name}[*])`);
    if (type === "array") assert.ok(asArray, `array parameter "${name}" needs a [*] reference`);
    else assert.ok(!asArray, `string parameter "${name}" cannot be expanded with [*]`);
  }
});

test("every result the run step writes is declared, and vice versa", () => {
  const used = new Set([...taskText.matchAll(/\$\(results\.([a-z-]+)\.path\)/g)].map((m) => m[1]));
  assert.deepEqual([...used].sort(), [...results].sort());
});

test("every $PARAM_ env var a script reads is set on its step", () => {
  for (const step of task.spec.steps) {
    const provided = new Set((step.env ?? []).map((e) => e.name));
    const read = new Set(
      [...(step.script ?? "").matchAll(/\$\{?(PARAM_[A-Z_]+)/g)].map((m) => m[1]),
    );
    for (const name of read) {
      assert.ok(provided.has(name), `step "${step.name}" reads $${name} but does not set it`);
    }
  }
});

test("the example pipeline drives the task with parameters it has", () => {
  const pipeline = manifests.get("testfile-pipeline.yaml")[0];
  const testTask = pipeline.spec.tasks.find((t) => t.taskRef?.name === task.metadata.name);
  assert.ok(testTask, "the pipeline never references the testfile task");
  for (const param of testTask.params ?? []) {
    assert.ok(params.has(param.name), `pipeline passes unknown parameter "${param.name}"`);
    const type = Array.isArray(param.value) ? "array" : "string";
    assert.equal(type, params.get(param.name), `parameter "${param.name}" has the wrong type`);
  }
  const workspaces = new Set(task.spec.workspaces.map((w) => w.name));
  for (const ws of testTask.workspaces ?? []) {
    assert.ok(workspaces.has(ws.name), `pipeline binds unknown workspace "${ws.name}"`);
  }
});

test("the rbac manifest grants the service account its roles", () => {
  const docs = manifests.get("testfile-rbac.yaml");
  const account = docs.find((d) => d.kind === "ServiceAccount");
  assert.ok(account, "no ServiceAccount");
  const roles = new Set(docs.filter((d) => d.kind === "Role").map((d) => d.metadata.name));
  for (const binding of docs.filter((d) => d.kind === "RoleBinding")) {
    assert.ok(
      roles.has(binding.roleRef.name),
      `RoleBinding ${binding.metadata.name} references unknown Role ${binding.roleRef.name}`,
    );
    assert.ok(
      binding.subjects.some((s) => s.name === account.metadata.name),
      `RoleBinding ${binding.metadata.name} does not bind the ${account.metadata.name} account`,
    );
  }
});

test("the documentation names every parameter and result of the task", () => {
  const doc = readFileSync(join(root, "docs", "tekton.md"), "utf8");
  for (const name of [...params.keys(), ...results]) {
    assert.ok(doc.includes(`\`${name}\``), `docs/tekton.md does not mention \`${name}\``);
  }
});
