---
title: Environment & ports
order: 6
description: Environment variables, random ports and template expressions.
---

# Environment & ports

## Environment variables

`env` can be set at the top level, on any test and on any service. Maps merge
child-over-parent, so a test sees its own variables on top of everything its
ancestors defined:

```yaml
version: 1
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

The runner's own shell environment is the base layer, so `PATH`, `HOME` etc.
stay available.

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

Referencing an undefined name is an error — typos fail fast instead of
expanding to an empty string.
