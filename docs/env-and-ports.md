---
title: Environment & ports
order: 6
description: Environment variables, random ports and template expressions.
---

# Environment & ports

## An isolated environment

Tests and services do **not** inherit your shell's (or the CI job's)
environment — runs behave the same on every machine, and a stray
`DATABASE_URL` on your laptop can't silently change what is tested. The
base environment is:

- **Essentials from the host**: `PATH`, `HOME`, `USER`, `LOGNAME`, `SHELL`,
  `TMPDIR`/`TMP`/`TEMP`, `LANG`, `LC_*`, `TZ` (and their Windows
  equivalents) pass through, so commands just work.
- **Runner-provided defaults**: `CI=1`, plus `FORCE_COLOR=1` and
  `CLICOLOR_FORCE=1` so tools keep their color output even though the
  runner captures it through pipes. `TESTFILE_OS` and `TESTFILE_ARCH`
  describe the platform.

Everything else must be forwarded explicitly with `forwardEnv` — a list of
names or `*` patterns, at the top level or per test (applying to its
subtree):

```yaml
version: 0
forwardEnv:
  - GITHUB_*            # all GitHub Actions variables, for the whole run
test:
  sequence:
    - name: uses a token
      forwardEnv: [NPM_TOKEN]
      command: npm whoami
    - name: everything    # escape hatch: the full host environment
      forwardEnv: ["*"]
      command: ./legacy-test.sh
```

Forwarded variables override the runner's defaults (forward `CI` to get
the host's value), while explicit `env` entries and env files win over
forwarded values. Ad-hoc forwarding without editing the Testfile:
`testfile run --forward-env 'GITHUB_*'` (also on `testfile tui`).

## Environment variables

`env` can be set at the top level, on any test and on any service. Maps merge
child-over-parent, so a test sees its own variables on top of everything its
ancestors defined:

```yaml
version: 0
env:
  NODE_ENV: test
test:
  env:
    LOG_LEVEL: warn
  sequence:
    - name: verbose one
      env:
        LOG_LEVEL: debug     # only here
      command: npm run test:one
    - name: two
      command: npm run test:two
```

The [isolated base environment](#an-isolated-environment) is the bottom
layer, so `PATH`, `HOME` etc. stay available while the rest of the host
environment stays out.

## Env files and secrets

Load dotenv files instead of hard-coding values — at the top level or per
test:

```yaml
version: 0
envFile: .env.test          # relative to the Testfile
test:
  sequence:
    - name: integration
      envFile:              # relative to the test's workdir, later wins
        - .env.integration
        - .env.integration.local
      command: npm run test:integration
```

Files use the usual dotenv format (`KEY=VALUE`, `#` comments, optional
`export `, quoted values) and may contain `${{ ... }}` templates. Explicit
`env` entries win over env file values; a missing file is an error.

Values loaded from env files are treated as **secrets**: they are masked as
`***` in the logs recorded under `.testfile/` and never written into
the recorded `run.yaml` — so tokens and passwords don't end up in your run history.

## Named ports

Hard-coded ports make test runs collide — with each other and with whatever
else is running on the machine. Declare named ports instead:

```yaml
ports:
  web: random   # a free port, allocated at run start
  db: 5432      # pinned
```

`random` asks the runner for a currently free TCP port. Reference ports
anywhere with `${{ ports.NAME }}`:

```yaml
services:
  web:
    command: npm start
    env:
      PORT: ${{ ports.web }}
test:
  env:
    BASE_URL: http://localhost:${{ ports.web }}
  command: npm run test:e2e
```

## Templates

String values anywhere in the file can use `${{ scope.name }}`:

| Scope    | Example              | Value |
| -------- | -------------------- | ----- |
| `env`    | `${{ env.HOME }}`    | A variable from the merged environment. |
| `ports`  | `${{ ports.web }}`   | A resolved named port. |
| `matrix` | `${{ matrix.node }}` | A matrix variable of the current instance. |

Defaults use `||` and apply when the reference is undefined or empty:

```yaml
env:
  PORT: ${{ env.PORT || 3000 }}
  MODE: ${{ env.MODE || 'local dev' }}
```

Referencing an undefined name *without* a default is an error — typos fail
fast instead of expanding to an empty string.
