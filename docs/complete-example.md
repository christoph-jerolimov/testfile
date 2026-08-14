---
title: A complete Testfile
order: 12
description: One file using nearly every feature at once, annotated — a map of the format rather than a template to copy.
---

# A complete Testfile

Every other page introduces one idea at a time. This one puts nearly all of
them into a single file, so you can see how they fit together and find the
key you half-remember.

**It is a map, not a template.** No real project needs this much: a good
Testfile is usually thirty lines. Copy the two or three parts you recognise,
not the whole thing.

The file below is validated against the
[JSON schema](https://github.com/christoph-jerolimov/testfile/blob/main/schema/testfile.schema.json)
on every commit, so it cannot drift away from what the runner accepts.

```yaml
version: 0
name: Acme Shop

# ── the environment every test and service starts from ──────────────────
# Tests do not inherit your shell. These three lines are the ways in.
forwardEnv: [CI, GITHUB_*] # host variables, by name or pattern
secrets: [NPM_TOKEN] # forwarded *and* masked in everything recorded
envFile: .env.test # a dotenv file next to this Testfile

env:
  NODE_ENV: test
  # `||` gives a default when the variable is unset
  LOG_LEVEL: ${{ env.LOG_LEVEL || warn }}

# Named ports: `random` is allocated per run, so two runs never collide.
ports:
  api: random
  db: random
  cache: random
  smtp: 1025 # pinned, because the mail client hard-codes it

# ── services: what the tests need running ───────────────────────────────
services:
  postgres:
    description: The database the API and the integration tests share.
    container:
      image: docker.io/library/postgres:16-alpine
      pull: missing # always | missing | never
      network: acme # containers reach each other by service name
      ports: ["${{ ports.db }}:5432"]
      env:
        POSTGRES_PASSWORD: test
        POSTGRES_DB: shop
      volumes: ["./fixtures/pg:/docker-entrypoint-initdb.d:ro"]
    ready:
      # runs *inside* the container, so the image's own client is used
      exec: pg_isready -h 127.0.0.1 -p 5432 -U postgres
      interval: 500ms
      timeout: 60s

  migrate:
    description: A step, not a server - it runs once and has to finish.
    once: true
    needs: [postgres] # starts when postgres is ready
    timeout: 5m
    command: npm run db:migrate
    env:
      DATABASE_URL: postgres://postgres:test@127.0.0.1:${{ ports.db }}/shop

  seed:
    once: true
    needs: [migrate] # ... and this one after the migrations
    script: |
      psql "$DATABASE_URL" -f fixtures/base.sql
      psql "$DATABASE_URL" -f fixtures/products.sql
    env:
      DATABASE_URL: postgres://postgres:test@127.0.0.1:${{ ports.db }}/shop

  api:
    description: The application under test.
    needs: [seed] # everything above is done before it boots
    command: npm run start:api
    workdir: services/api
    env:
      PORT: ${{ ports.api }}
      DATABASE_URL: postgres://postgres:test@127.0.0.1:${{ ports.db }}/shop
    ready:
      # all four kinds of check exist; all the ones you set must pass
      http:
        url: http://127.0.0.1:${{ ports.api }}/healthz
        method: GET
        status: 200
      tcp: ${{ ports.api }}
      log:
        pattern: listening on
        stream: stdout
      delay: 250ms
      interval: 250ms
      timeout: 30s
    stop:
      signal: SIGINT # default SIGTERM
      timeout: 5s # grace period before SIGKILL

# ── the suite ───────────────────────────────────────────────────────────
test:
  name: ci
  sequence:
    # A group whose children run at once, as a DAG: `needs` names siblings.
    - name: checks
      maxParallel: 2 # at most two of the three at a time
      parallel:
        - name: lint
          command: npm run lint
          tags: [fast]
          # skipped when nothing it depends on changed since the last pass
          inputs: ["**/*.ts", "eslint.config.js", "package-lock.json"]
        - name: types
          command: npm run typecheck
          tags: [fast]
          inputs: ["**/*.ts", "tsconfig*.json"]
        - name: build
          command: npm run build
          needs: [types] # only after the types pass
          inputs: ["src/**", "package-lock.json"]
          artifacts: ["dist/**"] # kept with the run

    # One instance per combination - four here, each with its own name.
    - name: unit
      matrix:
        node: ["20", "22"]
        shard: ["1/2", "2/2"]
      container:
        # the body runs in this image, with the project mounted
        image: docker.io/library/node:${{ matrix.node }}
        workdir: /workspace
        volumes: ["npm-cache:/root/.npm"]
        options: ["--user", "1000:1000"]
      services:
        redis:
          # one instance for all four combinations, not four of them -
          # `shared` matches on the *resolved* configuration
          shared: true
          container:
            image: docker.io/library/redis:7-alpine
            ports: ["${{ ports.cache }}:6379"]
          ready:
            exec: redis-cli ping
      command: npm run test:unit -- --shard=${{ matrix.shard }}
      env:
        REDIS_URL: redis://127.0.0.1:${{ ports.cache }}
      timeout: 10m

    # Generated from the folders that match, one test each.
    - name: packages
      foreach:
        glob: packages/*
        folder: true
        ignore: [packages/legacy]
      template:
        name: ${{ each.name }}
        workdir: ${{ each.path }}
        command: npm test
        tags: [unit]

    # The services this test needs, started before it and stopped after.
    - name: integration
      description: Talks to a real database, through the real API.
      tags: [slow, db]
      # a service only this test needs: started before it, stopped after.
      # The run-level services above are already up and are not repeated.
      services:
        mailhog:
          container:
            image: docker.io/mailhog/mailhog
            ports: ["${{ ports.smtp }}:1025"]
          ready:
            tcp: ${{ ports.smtp }}
      setup:
        command: npm run db:reset
        timeout: 2m
      teardown:
        # always runs, even when the test failed
        command: npm run db:dump -- --out artifacts/db.sql
      command: npm run test:integration
      env:
        BASE_URL: http://127.0.0.1:${{ ports.api }}
      retry: { count: 2, delay: 5s } # flaky against a cold cache
      artifacts: ["artifacts/**", "reports/junit-*.xml"]

    # Only on Linux, and a failure here does not fail the run.
    - name: browser
      if: ${{ env.TESTFILE_OS }} == linux && ${{ env.CI }} == 1
      continueOnError: true
      shell: bash -e # instead of the default sh
      script: |
        npx playwright install --with-deps chromium
        npx playwright test --reporter=line
      workdir: e2e
      timeout: 20m
      artifacts: ["e2e/playwright-report/**"]

    # Another Testfile, embedded here as a nested suite.
    - name: docs
      include: docs/Testfile
```

## What is *not* in it

A few things cannot appear in the same file as their alternatives, so they
are worth naming here:

| Instead of | you may also write |
| ---------- | ------------------ |
| `ready.exec` running in the container | `exec: {command: …, host: true}` to run it on [your machine](./services#where-exec-runs) |
| `foreach` with a `template` | [`include`](./writing-tests#composing-testfiles) with a glob, when each package has its own Testfile |
| `retry: {count, delay}` | a plain `retry: 2` |
| `container.context` / `namespace` | only read when the run's engine is [kubernetes](./services#services-on-a-kubernetes-cluster) |
| `container.volumes` / `network` above | rejected by that engine — [host paths mean nothing on a cluster](./services#what-containers-can-see-of-your-project) |

And two whole mechanisms live outside the file on purpose: which
[container engine](./services#containers) runs the containers is the
runner's choice (`--engine`, `TESTFILE_ENGINE`), and any value here can be
[overridden for one run](./cli#overriding-the-testfile-for-one-run) with
`-c` or a `TESTFILE_CONFIG_` variable — so a file like this one never needs
an edit to run somewhere slightly different.

## Reading it back

```sh
testfile inspect          # the suite as the runner expands it, matrix and all
testfile validate         # against the schema, with the line of any error
testfile doctor           # does this machine have what the file needs?
testfile tags             # the tags it uses, to build a filter from
```
