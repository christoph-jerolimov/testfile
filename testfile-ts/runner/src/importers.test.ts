import assert from "node:assert/strict";
import { test } from "node:test";
import {
  fromDockerCompose,
  fromGithubWorkflow,
  fromJustfile,
  fromMakefile,
  fromTaskfile,
  kindOf,
} from "./importers.js";

test("docker-compose services become container services", () => {
  const result = fromDockerCompose(`
services:
  db:
    image: postgres:16-alpine
    ports: ["5432:5432"]
    environment:
      POSTGRES_PASSWORD: secret
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 2s
  api:
    image: acme/api
    depends_on:
      db:
        condition: service_healthy
    ports: ["8080:3000"]
    environment:
      - TOKEN=abc
`);

  assert.deepEqual(result.ports, { db: "random", api: "random" }, "host ports become random ports");
  const db = result.services.db;
  assert.equal(db.container!.image, "postgres:16-alpine");
  assert.deepEqual(db.container!.ports, ["${{ ports.db }}:5432"]);
  assert.deepEqual(db.container!.env, { POSTGRES_PASSWORD: "secret" });
  assert.deepEqual(db.ready, { exec: "pg_isready -U postgres", timeout: "60s", interval: "2s" });

  const api = result.services.api;
  assert.deepEqual(api.needs, ["db"], "depends_on becomes health-gated needs");
  assert.deepEqual(api.container!.ports, ["${{ ports.api }}:3000"], "the container port is kept");
  assert.deepEqual(api.container!.env, { TOKEN: "abc" }, "list-style environment is parsed");
  assert.deepEqual(
    api.ready,
    { tcp: "${{ ports.api }}", timeout: "60s" },
    "no healthcheck: wait for the port",
  );
});

test("compose services without image or checks are reported", () => {
  const result = fromDockerCompose(`
services:
  worker:
    image: acme/worker
  built:
    build: .
`);
  assert.deepEqual(result.services.worker.ready, undefined);
  assert.ok(
    result.notes.some((note) => note.includes('"worker"') && note.includes("ready")),
    "a service without ports and healthcheck is flagged",
  );
  assert.ok(
    result.notes.some((note) => note.includes("build:")),
    "build-only services are flagged",
  );
});

test("GitHub workflow run steps become tests, action steps are dropped", () => {
  const result = fromGithubWorkflow(`
name: CI
jobs:
  build:
    steps:
      - uses: actions/checkout@v4
      - name: install
        run: npm ci
      - name: unit
        run: npm test
  lint:
    name: linting
    steps:
      - run: npm run lint
`);
  assert.deepEqual(
    result.tests.map((entry) => entry.name),
    ["build", "linting"],
    "one test per job, the job's name wins",
  );
  assert.deepEqual(
    result.tests[0].sequence!.map((step) => step.name),
    ["install", "unit"],
  );
  assert.equal(result.tests[1].script, "npm run lint", "a single step collapses into the job");
  assert.ok(result.notes.some((note) => note.includes("action step")));
});

test("Makefile, Taskfile and justfile contribute their check targets", () => {
  assert.deepEqual(
    fromMakefile("all: test\n\ntest:\n\tgo test ./...\n\nbuild:\n\tgo build\n\nlint:\n\tvet\n")
      .tests,
    [
      { name: "test", command: "make test" },
      { name: "lint", command: "make lint" },
    ],
    "only test-ish targets, and never the phony all/clean",
  );
  assert.deepEqual(
    fromTaskfile("tasks:\n  test:\n    cmds: [go test]\n  deploy:\n    cmds: [ship]\n").tests,
    [{ name: "test", command: "task test" }],
  );
  assert.deepEqual(fromJustfile("test:\n    cargo test\n\ndeploy target:\n    ship\n").tests, [
    { name: "test", command: "just test" },
  ]);
});

test("kindOf recognises the supported files", () => {
  assert.equal(kindOf("compose.yaml"), "compose");
  assert.equal(kindOf("/p/docker-compose.yml"), "compose");
  assert.equal(kindOf("/p/.github/workflows/ci.yaml"), "workflow");
  assert.equal(kindOf("Makefile"), "makefile");
  assert.equal(kindOf("Taskfile.yml"), "taskfile");
  assert.equal(kindOf("justfile"), "justfile");
  assert.equal(kindOf("random.txt"), undefined);
  assert.equal(kindOf("some/other.yaml"), undefined, "a plain yaml is not a workflow");
});
