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
  engine: auto            # podman if available, else docker
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

`engine: auto` prefers podman and falls back to docker. It never picks
kubernetes — that engine has to be asked for.

With `network`, service containers can talk to each other directly: each
container joins the named network with its service name as alias, so an app
container reaches its database at `db:5432` instead of going through host
ports. The network is created on first use and left in place after the run.

## Services on a Kubernetes cluster

`engine: kubernetes` runs the service as a pod on whatever cluster your
kubeconfig points at — a remote one, or a local kind/minikube. Nothing else
about the Testfile changes:

```yaml
services:
  db:
    container:
      image: docker.io/library/postgres:16
      engine: kubernetes
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
  exec: pg_isready -h localhost -p ${{ ports.db }}
  delay: 1s        # wait before the first check
  interval: 500ms  # poll interval (default 1s)
  timeout: 60s     # give up after this (default 30s), failing the run
```

Set any combination of `http`, `tcp`, `log` and `exec` — all configured
checks must pass. `exec` runs a probe command (in the service's env and
workdir) until it exits with code 0, which is ideal for tools that ship
their own readiness probe like `pg_isready` or `redis-cli ping`. If the service exits before becoming ready (or dies later while tests
still depend on it), the dependent tests are aborted and the run fails.

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
