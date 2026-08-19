---
title: pytest + PostgreSQL
order: 1
stack: Python
description: >-
  Unit tests without a database, integration tests against a real PostgreSQL
  container — migrations applied in a setup hook, on a random port.
---

# pytest + PostgreSQL

Unit tests without a database, integration tests against a real PostgreSQL
container — migrations applied in a setup hook, on a random port.

This guide shows:

- Container service with an `exec` readiness check (`pg_isready`)
- Random port wired into `DATABASE_URL`, so parallel runs never collide
- Only the integration test requests the service; unit tests stay fast
- `setup` runs the migrations before the tests
