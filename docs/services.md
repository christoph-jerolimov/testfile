---
title: Services
order: 5
description: Start the app under test, databases and other dependencies — and stop them gracefully.
---

# Services

Tests rarely run in a vacuum: they need the web server or app under test, a
database in a specific version, sometimes a whole set of dependencies. A
Testfile declares these as **services**. The runner

1. starts them (as local processes or containers),
2. waits until they are **ready**,
3. runs the dependent tests,
4. **gracefully stops** them — in reverse start order, and also when you
   interrupt the run with Ctrl+C.

## Declaring services

Services declared at the top level live for the whole run. Services declared
on a test start right before that test and stop when it — including all its
nested tests — finished:

```yaml
version: 0
ports:
  web: random
services:              # for the whole run
  web:
    command: npm start
    env:
      PORT: ${{ ports.web }}
    ready:
      http: http://localhost:${{ ports.web }}/healthz
test:
  name: integration
  services:            # only while this test runs
    postgres:
      container:
        image: docker.io/library/postgres:16
        ports:
          - "${{ ports.db }}:5432"
        env:
          POSTGRES_PASSWORD: test
      ready:
        log: database system is ready to accept connections
  command: npm run test:integration
```

A service runs either a local `command`/`script` or a `container`.

## Service dependencies

Services in one map start concurrently. When one of them needs another to
be up first — the app that talks to the database on boot — declare it with
`needs`:

```yaml
services:
  db:
    container:
      image: docker.io/library/postgres:16-alpine
      ports: ["${{ ports.db }}:5432"]
      env:
        POSTGRES_PASSWORD: test
    ready:
      log: database system is ready to accept connections
  app:
    # starts only once db passed its readiness check
    needs: [db]
    command: npm start
    env:
      DATABASE_URL: postgresql://postgres:test@127.0.0.1:${{ ports.db }}/postgres
    ready:
      http: http://127.0.0.1:${{ ports.app }}/healthz
```

`needs` is docker-compose's `depends_on`, except it always waits for the
[readiness check](#readiness-checks), never just for the process or
container to exist — which is the difference between a working setup and a
retry loop in your app. Names must refer to services in the same map, and
cycles are rejected when the Testfile is loaded. Services without `needs`
still start immediately and in parallel, so only the actual chain is
serialized. If a dependency never becomes ready, the services that need it
are never started and the test fails with the dependency's error.

## Steps between services

Some things have to happen *after* a service is up and *before* the tests
run: migrations, a fixture load, a bucket that has to exist. `oneshot: true`
makes an entry a step rather than a server — it runs once, and exiting with
code 0 is what makes it ready:

```yaml
ports:
  db: random
services:
  postgres:
    container:
      image: docker.io/library/postgres:16
      ports: ["${{ ports.db }}:5432"]
      env:
        POSTGRES_PASSWORD: test
    ready:
      exec: pg_isready -h 127.0.0.1 -p 5432
  seed:
    oneshot: true          # a step, not a server
    needs: [postgres]      # runs once postgres is ready
    command: ./scripts/seed.sh
    timeout: 2m
    env:
      DATABASE_URL: postgresql://postgres:test@127.0.0.1:${{ ports.db }}/postgres
test:
  command: yarn e2e        # starts after seed finished
```

The point is that the step is *in the graph*. It waits for the database
itself — no polling loop of your own, no second copy of the readiness check
inside `seed.sh`. And anything that names it in `needs` waits for it to have
**finished**, not merely to have started, so a chain reads in the order it
happens:

```yaml
services:
  postgres: { container: { image: docker.io/library/postgres:16 }, ready: { ... } }
  migrate:  { oneshot: true, needs: [postgres], command: npm run migrate }
  seed:     { oneshot: true, needs: [migrate],  command: npm run seed }
  app:      { needs: [seed], command: npm start, ready: { http: ... } }
```

A step that exits non-zero fails the run: nothing that needed it starts, and
the error names the step. Its output is kept like any service's log, which
is usually where the reason is. Because it is expected to end, a one-shot has
no `ready` check (the exit code is the signal) and no `stop` (nothing is left
running) — both are rejected when the Testfile loads. `timeout` is the one
field only a one-shot has; without it a wedged step waits forever.

Everything else about services still applies: a step can be a `command`, a
`script` or a `container` (`image: postgres:16` with `command: [psql, ...]`
needs no client installed locally), and `shared: true` runs it once for all
the tests that share it.

### Do I need a step, or a setup hook?

A [`setup` hook](./writing-tests#setup-and-teardown) runs after *all* of a
test's services are ready and belongs to that one test. Reach for a one-shot
service when the work belongs to the service rather than to a test — when
another **service** has to wait for it (a setup hook cannot sit between two
services), when several tests need it done once, or when you want it in the
service log with its own name and duration. Otherwise a setup hook is the
simpler thing.

## Sharing services

By default every test (and every matrix instance) starts its own copy of the
services it declares. With `shared: true` a single instance is reused by all
tests whose *resolved* configuration is identical:

```yaml
test:
  matrix:
    node: ["20", "22"]
  services:
    postgres:
      shared: true              # one postgres for both node versions
      container:
        image: docker.io/library/postgres:16
        ports: ["${{ ports.db }}:5432"]
```

The service starts with the first test that needs it and stops after the
last one finished. If the configuration depends on a matrix variable (say,
`image: postgres:${{ matrix.postgres }}`), each distinct configuration still
gets its own instance — sharing only kicks in where it is safe.

## Containers

```yaml
container:
  image: docker.io/library/postgres:16
  pull: missing           # always | missing | never
  network: testnet        # created if needed; service name = network alias
  ports:
    - "${{ ports.db }}:5432"
  env:
    POSTGRES_PASSWORD: test
  volumes:
    - ./fixtures:/docker-entrypoint-initdb.d:ro
  entrypoint: [/bin/sh, -c]   # optional overrides
  command: ["./start.sh"]
```

Note what is *not* here: an engine. The Testfile describes what runs; which
engine runs it — podman, docker or kubernetes — is decided by whoever runs
the tests:

1. `testfile start --engine podman` (or `docker`, or `kubernetes`),
2. else the `TESTFILE_ENGINE` environment variable,
3. else the first of podman, docker, kubernetes that actually **responds**
   — a docker CLI whose daemon is down, or a kubectl without a reachable
   cluster, is skipped, not picked.

The same file runs under podman on one laptop, docker in CI and a cluster
in staging, without an edit. `testfile doctor` checks all three engines and
says which one a run on this machine would use.

With `network`, service containers can talk to each other directly: each
container joins the named network with its service name as alias, so an app
container reaches its database at `db:5432` instead of going through host
ports. The network is created on first use and left in place after the run.

## Services on a Kubernetes cluster

When the run's engine is kubernetes — `--engine kubernetes`,
`TESTFILE_ENGINE=kubernetes`, or nothing local responding while kubectl
reaches a cluster — services run as pods on whatever cluster your
kubeconfig points at, a remote one or a local kind/minikube. Nothing about
the Testfile changes:

```yaml
services:
  db:
    container:
      image: docker.io/library/postgres:16
      namespace: ci          # optional; must exist (kubectl's default otherwise)
      context: staging       # optional kubeconfig context
      ports:
        - "${{ ports.db }}:5432"
      env:
        POSTGRES_PASSWORD: test
    ready:
      tcp: ${{ ports.db }}
      timeout: 120s
```

The declared ports are forwarded from `127.0.0.1` into the pod, so your
tests and readiness checks connect to localhost exactly as they would with
published container ports — `DATABASE_URL=postgres://…@localhost:${{ ports.db }}/…`
keeps working unchanged.

Between services the wiring is better than the forward suggests: each
service with ports also gets a Kubernetes Service carrying its name, so
sibling services in the same namespace reach each other by name over
cluster DNS (`db:5432`), the same way the network alias works for container
networks. `needs` between services behaves as always.

What the runner does for stability, since two clusters hops are involved:

- **Pod status is followed while starting.** A typo'd image fails in
  seconds with the registry's message (`InvalidImageName`,
  `ErrImagePull`…) instead of idling into the readiness timeout.
- **Logs are streamed** (`ready.log` matches on them, and they end up in
  the run folder like any service log). If the log stream or the
  port-forward drops — both are known to die on network hiccups — it is
  re-established automatically while the pod still runs.
- **A pod that dies is a failed service**: pods run with
  `restartPolicy: Never`, so a crash aborts the dependent tests instead of
  being silently restarted behind the runner's back.
- **Cleanup deletes the pod and its Service** (the `stop` timeout becomes
  the grace period). Everything is labelled
  `app.kubernetes.io/managed-by: testfile`, so leftovers of a crashed
  runner are one `kubectl delete ... -l` away.

Limits worth knowing: `volumes` and `network` are rejected (host paths mean
nothing on a cluster; DNS already covers service-to-service), a
[test body container](./writing-tests#running-a-test-in-a-container) still
runs locally, and two concurrent runs sharing a namespace would fight over
the DNS name — give them separate namespaces. `testfile doctor` checks that
kubectl is installed and the cluster answers.

## Readiness checks

Starting a process is not the same as it being usable. `ready` describes how
the runner knows the service is actually up; dependent tests only start after
**all** their services are ready.

```yaml
ready:
  http:
    url: http://localhost:${{ ports.web }}/healthz
    status: 200
  tcp: ${{ ports.db }}
  log:
    pattern: ready to accept connections
    stream: any
  exec: pg_isready -h localhost -p 5432
  delay: 1s        # wait before the first check
  interval: 500ms  # poll interval (default 1s)
  timeout: 60s     # give up after this (default 30s), failing the run
```

Set any combination of `http`, `tcp`, `log` and `exec` — all configured
checks must pass. `exec` runs a probe command until it exits with code 0,
which is ideal for tools that ship their own readiness probe like
`pg_isready` or `redis-cli ping`. If the service exits before becoming ready
(or dies later while tests still depend on it), the dependent tests are
aborted and the run fails.

### Combining checks

Every configured check is evaluated in **every round**, all of them at once,
and the service is ready the first time they are **all true together**:

```yaml
ready:
  tcp: ${{ ports.db }}       # the published port is forwarded, and
  exec: pg_isready -p 5432   # postgres itself accepts connections
  timeout: 60s
```

Two port numbers in one block is not a typo. `tcp` and `http` always connect
from the machine running the tests, so they name the published port, while
`exec` on a container service runs [inside it](#where-exec-runs) and names
the port the service listens on. One `ready:` block can watch from both
sides at once.

What follows from "all at once, every round":

- **There is no ordering.** The checks start together, so the probe already
  runs while the port is still refusing connections. You cannot express
  "wait for the port, *then* run the probe" — and you rarely need to, since a
  failing round simply repeats.
- **Nothing is remembered.** `tcp`, `http` and `exec` are re-tested from
  scratch each round, so a port that opened two rounds ago counts for nothing
  if it is closed again now. `log` is the exception: it re-reads the output
  from the service's start, so once the line has appeared it keeps matching.
- **One clock for the group.** A single `delay`, one `interval` between
  rounds and one `timeout` deadline — not one per check.
- **The slowest check sets the pace.** A round cannot end before its slowest
  leg, and a single attempt is capped per kind: 5s for `http`, 2s for `tcp`,
  10s for `exec`. With `interval: 500ms` and a probe that takes 3s, rounds
  come about every 3.5s.
- **More checks can only make a service ready later**, never sooner. `tcp`
  next to an `exec` probe that connects to that same port is redundant — the
  probe already proves the port answers.

When the deadline passes, the error names the checks that were still failing
in the last round, so a combination stays debuggable — here the `tcp` leg
had come up and the probe had not:

```
✘ service db failed: not ready after 1m00s (exec did not exit 0)
```

### Where `exec` runs

Most services ship their own readiness probe, and it lives *in the image* —
`pg_isready` in `postgres`, `redis-cli` in `redis`. So a container service is
probed **from the inside**, and only a service that has no inside is probed
on the machine running the tests:

| the service is… | the command runs… | with… |
| --------------- | ----------------- | ----- |
| a `container:` | inside that container — `podman exec` / `docker exec`, or `kubectl exec` into the pod on the [kubernetes engine](#services-on-a-kubernetes-cluster) | the image's filesystem, user and `WORKDIR`; the image's environment plus `container.env`; the ports the service really listens on |
| a `container:` with `host: true` | on the machine running the tests | the project's files, the service's `workdir` and `env`, and the **published** ports |
| a `command:` or `script:` (a plain process) | on the machine running the tests | the same; `host:` is accepted but has nothing to opt out of |

Both forms are a shell line handed to `sh -c`, so `&&`, pipes and quoting all
work as usual — and on Windows a host-side probe needs an `sh` on `PATH`, the
same one your tests use ([`testfile doctor`](./cli#checking-the-machine)
checks for it).

#### A container probes itself

Nothing has to be installed locally, and the command names the port the
service listens on inside the container — `5432`, not the random published
one:

```yaml
ports:
  db: random
services:
  postgres:
    container:
      image: docker.io/library/postgres:16
      ports:
        - "${{ ports.db }}:5432"
      env:
        POSTGRES_PASSWORD: test
    ready:
      # -h 127.0.0.1 checks the TCP listener the tests will use; without it
      # pg_isready asks the unix socket, which is ready a moment earlier
      exec: pg_isready -h 127.0.0.1 -p 5432 -U postgres
      timeout: 60s
```

The usual one-liners, all of which run in the image and need nothing on the
machine running the tests:

| image | probe |
| ----- | ----- |
| `postgres` | `pg_isready -h 127.0.0.1 -p 5432` |
| `redis` | `redis-cli ping` |
| `mysql`, `mariadb` | `mysqladmin ping -h 127.0.0.1 --silent` |
| `mongo` | `mongosh --quiet --eval "db.runCommand({ ping: 1 }).ok"` |
| `rabbitmq` | `rabbitmq-diagnostics -q ping` |
| `elasticsearch` | `curl -fsS localhost:9200/_cluster/health` |

These are what those images ship today, not a promise — a slimmed-down image
may not have the client at all. `tcp:` asks nothing of the image and is the
better check whenever "the port answers" is really what you mean.

#### Probing from the outside with `host: true`

Set `host: true` when the check belongs on this machine instead — a tool
installed here, a client the image does not contain, or something that is
only reachable through the published port:

```yaml
ports:
  s3: random
services:
  minio:
    container:
      image: docker.io/minio/minio
      ports:
        - "${{ ports.s3 }}:9000"
    ready:
      exec:
        command: curl -fsS http://localhost:${{ ports.s3 }}/minio/health/live
        host: true
```

It is also the way out when the image has **no shell**: `sh -c` has to exist
in there, so distroless and `scratch`-based images cannot be entered at all.
Probe those from the outside, or use `tcp`/`http`, which never enter the
container:

```yaml
    ready:
      tcp: ${{ ports.api }} # no shell needed anywhere
```

With the kubernetes engine the difference is a machine, not just a namespace:
the in-container probe executes **in the cluster**, while `host: true` runs
next to your tests and reaches the pod only through the forwarded
`127.0.0.1` port.

#### Templates resolve the same either way

`${{ ports.x }}`, `${{ env.x }}` and `${{ matrix.x }}` are substituted by the
runner *before* the command is handed over, so they mean the same thing in
both places — which is exactly the trap. `${{ ports.db }}` is the published
port on the host side, and inside the container nothing listens on it:

```yaml
    ready:
      # ✗ the published port - inside the container nothing listens there
      exec: pg_isready -p ${{ ports.db }}
```

```yaml
    ready:
      # ✓ the port the service itself listens on
      exec: pg_isready -p 5432
```

Environment variables are not shared between the two sides. Inside, the
command sees what the container process sees: the image's own variables plus
`container.env`. Outside, it sees the run's environment plus the service's
`env:` — the same one a `command:` service is started with.

#### What counts as ready

Exit code `0` means ready; anything else means *not yet* and is retried on
the next `interval` — a failing probe is normal while a service starts and is
never an error by itself. The run only fails when `timeout` expires — the
clock starts after `delay`, so the longest wait is `delay + timeout` — or
when the service dies first, which reports `exited before becoming ready`
instead of naming a check.

A single attempt is capped at **10s**. One that hangs is killed and retried,
so a wedged probe costs an interval instead of the whole run.

The probe's own output is discarded — neither stdout nor stderr reaches the
service log, which stays the service's. If a probe is not behaving, run the
same line by hand (`podman exec <container> sh -c '…'`) rather than looking
for it in the log.

#### `doctor` follows, `stop.command` does not

`testfile doctor` looks up the executables a Testfile names, but only for
probes that actually run here: an in-container probe is skipped, one with
`host: true` is checked like any other command.

`stop.command` is *not* symmetrical — it always runs on the machine running
the tests, because it usually operates on the container rather than in it.

#### Coming from docker-compose, or from an older Testfile

A compose `healthcheck` runs inside the container, so
[`testfile init`](./getting-started#1-create-a-testfile) carries it over
unchanged, container port and all.

Testfiles written before this rule probed containers through the published
port and needed the tool installed locally. Either aim the command at the
container port (usually shorter, and it stops depending on the machine), or
add `host: true` to keep it exactly as it was.

## Graceful shutdown

```yaml
stop:
  signal: SIGINT   # default SIGTERM
  timeout: 5s      # grace period before SIGKILL (default 10s)
```

Processes receive `signal` (to their whole process group) and get `timeout`
to exit before the runner escalates to SIGKILL. Containers are stopped with
`podman stop`/`docker stop` using the same timeout. Alternatively,
`stop.command` runs a custom shutdown command.

This shutdown path always runs: on success, on failure, and on Ctrl+C. A
first Ctrl+C stops tests and shuts services down gracefully; a second one
force-kills everything.
