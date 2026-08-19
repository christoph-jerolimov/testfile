---
title: Matrix across versions
order: 4
stack: Any
description: >-
  One test definition, five runs: three Node versions against two
  PostgreSQL versions, with one unsupported combination excluded.
---

# Matrix across versions

One test definition, five runs: three Node versions against two
PostgreSQL versions, with one unsupported combination excluded.

This guide shows:

- Cross product with `exclude`, expanded into separate tests
- Matrix values reach the service image and the command
- Every instance gets its own database container
- Run one combination with `-m node:22 -m postgres:17`
