---
title: Monorepo
order: 5
stack: Any
description: >-
  Each package owns its Testfile; the root file only wires them together
  with glob includes, so teams stay independent.
---

# Monorepo

Each package owns its Testfile; the root file only wires them together
with glob includes, so teams stay independent.

This guide shows:

- `include: packages/*` expands into one branch per package
- Included files run in their own directory; their named ports merge into the root's
- `inputs` per package: untouched packages come from the cache
- Filter to one package with `-n api`
