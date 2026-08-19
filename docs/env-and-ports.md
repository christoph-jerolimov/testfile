---
title: Environment & ports
order: 4
category: Test definition
description: Environment variables, random ports and template expressions.
---

# Environment & ports

## An isolated environment

Tests and services do **not** inherit your shell's (or the CI job's)
environment — runs behave the same on every machine, and a stray
`DATABASE_URL` on your laptop can't silently change what is tested. The
base environment is:

- **Essentials from the host**: `PATH`, `HOME`, `USER`, `LOGNAME`, `SHELL`,
  `TMPDIR`/`TMP`/`TEMP`, `LANG`, `LC_*`, `TZ`, `XDG_RUNTIME_DIR` (and their Windows
  equivalents) pass through, so commands just work.
- **Runner-provided defaults**: `CI=1`, plus `FORCE_COLOR=1` and
  `CLICOLOR_FORCE=1` so tools keep their color output even though the
  runner captures it through pipes. `TESTFILE_OS` and `TESTFILE_ARCH`
  describe the platform.

The reverse direction exists too: `TESTFILE_ENGINE` is a variable the
runner *reads* from its own environment to pick the
[container engine](./services#containers) — it is not placed into the test
environment, and tests have no reason to see it.

Everything else must be forwarded explicitly with `forwardEnv` — a list of
names or `*` patterns, at the top level or per test (applying to it and
its nested tests):

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
`testfile start --forward-env 'GITHUB_*'`.

### Handing variables in from outside

Sometimes the Testfile should not have to know a variable exists at all —
a base URL that differs per environment, a token your CI holds. Two
prefixes carry a variable in with **no** declaration anywhere: no
`forwardEnv`, no `env`, no `secrets`.

```bash
TESTFILE_ENV_BASE_URL=https://staging.example.com \
TESTFILE_SECRET_API_TOKEN="$CI_TOKEN" \
  testfile start
```

Inside the run those arrive as `BASE_URL` and `API_TOKEN` — the prefix is a
namespace on the host side and is stripped on the way in. Both reach every
test and every service, and both are visible to templates
(`${{ env.BASE_URL }}`) and to [`if` conditions](./writing-tests#conditional-tests)
like any other variable.

The difference between the two is what happens to the value afterwards:
`TESTFILE_SECRET_` **masks** it in everything the run records — test logs,
service logs, the recorded environment — exactly like naming it under
[`secrets`](#secrets-from-the-ci-environment). Use it for anything you would
not paste into a bug report.

Details worth knowing:

- They land **after** `forwardEnv` in the base environment, so naming a
  variable this way beats a broad pattern that also matches it, and beats the
  runner's own `CI=1`.
- They land **before** the Testfile's `env`, like every forwarded value —
  so a variable the file sets explicitly still wins. To override *that*, use
  a [config override](./cli#overriding-the-testfile-for-one-run):
  `TESTFILE_CONFIG_env__DATABASE_URL=…`.
- Both are **recorded by name** in the run (`fromEnvironment`), so a run
  says which variables it was given — never their values, secret or not.
- The same name under both prefixes is the masked one.
- `TESTFILE_ENV_` on its own names nothing and is ignored, and an empty
  `TESTFILE_SECRET_` value is passed through but not registered for masking —
  masking the empty string would blank out every line.

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
the recorded `run.yaml` — so tokens and passwords don't end up in your run
history. (Values shorter than 4 characters are not masked: they would mark
ubiquitous substrings as secret without hiding anything.)

### Secrets from the CI environment

CI systems hand secrets over as environment variables, and the test
environment is otherwise [isolated](#an-isolated-environment) from the
host. `secrets` names the variables that carry them — they are forwarded
*and* masked (a name that is unset or empty on the host is simply
skipped):

```yaml
version: 0
secrets: [NPM_TOKEN, DATABASE_PASSWORD]   # for the whole run
test:
  sequence:
    - name: publish dry-run
      secrets: [REGISTRY_TOKEN]           # ... or only for one test
      command: npm publish --dry-run
```

That covers GitHub Actions (`env: {NPM_TOKEN: ${{ secrets.NPM_TOKEN }}}` in
the workflow), GitLab CI variables, Jenkins credentials and Vault-style
tools that export into the environment — anything that ends up as an env
var works, no per-provider integration needed.

A value assigned to a secret name inside `env` is treated as secret too,
so a derived value stays masked:

```yaml
secrets: [DATABASE_URL]
env:
  DATABASE_URL: postgres://user:${{ env.DATABASE_PASSWORD }}@localhost/app
```

Masking applies to recorded logs and to the recorded `env`; the live
terminal output is not masked, exactly as with env files.

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

Ports declared at the top level exist for the whole run. Declared on a
test, they are scoped to that test and its nested tests — resolved when
the test starts, visible to its services and children, invisible to its
siblings — and merge over inherited ports (the test wins on a name
clash). A `random` port on a test is allocated per test instance, so
matrix instances never collide:

```yaml
test:
  ports:
    web: random
  services:
    web:
      command: npm start
      env:
        PORT: ${{ ports.web }}
  env:
    BASE_URL: http://localhost:${{ ports.web }}
  command: npm run test:e2e
```

## Templates

Most string values in the file can use `${{ scope.name }}` — the
exceptions are structural fields resolved before the run starts (`include`
paths, the `foreach` glob, `name`, `tags`, `needs`):

| Scope    | Example              | Value |
| -------- | -------------------- | ----- |
| `env`    | `${{ env.HOME }}`    | A variable from the merged environment. |
| `ports`  | `${{ ports.web }}`   | A resolved named port. |
| `matrix` | `${{ matrix.node }}` | A matrix variable of the current instance. |
| `each`   | `${{ each.path }}`   | Only inside a [`foreach` template](./writing-tests#one-test-per-folder-or-file): the current match. Substituted when the file loads, not at run time. |

Defaults use `||` and apply when the reference is undefined or empty:

```yaml
env:
  PORT: ${{ env.PORT || 3000 }}
  MODE: ${{ env.MODE || 'local dev' }}
```

Referencing an undefined name *without* a default is an error — typos fail
fast instead of expanding to an empty string. (The one exception is
[`if` conditions](./writing-tests#conditional-tests), where an undefined
reference resolves to `""` so a condition can probe optional variables.)
