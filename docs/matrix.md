---
title: Matrix builds
order: 4
description: Run one test across many combinations of versions and variants.
---

# Matrix builds

A `matrix` expands a single test into one instance per combination of its
variables — the cross product:

```yaml
test:
  name: integration
  matrix:
    node: ["20", "22"]
    db: [postgres, mysql]
  command: npm run test:integration
```

This runs 4 instances: `integration (node=20, db=postgres)`,
`integration (node=20, db=mysql)`, and so on. Instances run like a parallel
group.

## Using matrix values

Matrix values are available as `${{ matrix.NAME }}` templates and as
environment variables `TESTFILE_MATRIX_<NAME>`:

```yaml
test:
  matrix:
    node: ["20", "22"]
  env:
    NODE_VERSION: ${{ matrix.node }}
  command: ./run-with-node.sh "$NODE_VERSION"
```

## exclude and include

`exclude` removes combinations from the cross product; `include` appends
extra ones:

```yaml
matrix:
  node: ["20", "22"]
  db: [postgres, mysql]
  exclude:
    - node: "20"
      db: mysql
  include:
    - node: "23"
      db: postgres
```

## Matrix + services

Templates are also substituted in the instance's services, which makes
"test against three database versions" a three-line change:

```yaml
test:
  name: db tests
  matrix:
    postgres: ["15", "16", "17"]
  services:
    postgres:
      container:
        image: docker.io/library/postgres:${{ matrix.postgres }}
        ports:
          - "${{ ports.db }}:5432"
        env:
          POSTGRES_PASSWORD: test
      ready:
        log: database system is ready to accept connections
  command: npm run test:db
```

Each instance starts (and stops) its own container with its own version.
