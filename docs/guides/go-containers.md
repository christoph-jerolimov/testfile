---
title: Go + containers
order: 3
stack: Go
description: >-
  Testcontainers-style dependencies — Redis and Kafka — declared in the
  Testfile instead of started from test code, so `go test` stays plain.
---

# Go + containers

Testcontainers-style dependencies — Redis and Kafka — declared in the
Testfile instead of started from test code, so `go test` stays plain.

This guide shows:

- Container services with `tcp` and `log` readiness checks
- Short unit tests and slow integration tests split by tag
- `inputs` caching skips `go vet` and unit tests when no `.go` file changed
- The runner owns the container lifecycle, locally and on CI
