# Versioning and compatibility policy

This document defines how the Testfile format evolves: what may change
within a format version, what forces the next one, and what runners and
users can rely on. The [specification](README.md) describes *what* the
format is; this document describes *how it is allowed to change*.

## Current status: version 0, under review

The format is currently at **version 0**: a draft that is under review and
may still change based on feedback. **Version 1 — the first version covered
by the stability guarantees below — is targeted for Q4 2026.**

During version 0 the compatibility rules of this policy do **not** yet
apply: any part of the format (fields, defaults, semantics) may change
between releases. Breaking changes are called out in release notes, and the
schema, examples and conformance suite are updated in the same commit, but
there is no migration tooling and no deprecation window.

That freedom is the point of the review phase — it is the last chance to fix
mistakes cheaply. If a field name feels wrong, a default surprises you, or a
concept is missing, please say so now in a
[GitHub issue](https://github.com/christoph-jerolimov/testfile/issues).
Trying the format on a real project and reporting back is the most valuable
contribution you can make before version 1 freezes it.

## The version field

Every Testfile declares its format version:

```yaml
version: 0
```

The version describes the **document format and its execution semantics**,
not the version of any runner. There is exactly one current major version at
a time; today that is `0`.

## Changes allowed within version 1

*The rules in this and the following sections take effect when version 1
ships (targeted for Q4 2026). They are stated for version 1 and carry over
to every later major version.*

The format may grow without a version bump as long as **every valid
Testfile stays valid and keeps its meaning**. Allowed:

- **New optional fields** with a default that preserves existing behavior
  (this is how `tags`, `retry`, `if`, `needs`, `setup`/`teardown`,
  `artifacts`, `include`, `envFile`, `shared` and the container options were
  added).
- **New enum values** on existing fields, when omitting them keeps today's
  behavior (e.g. a future `engine: kubernetes` becoming functional).
- **New template scopes** (`${{ new.thing }}`); unknown scopes remain errors
  until introduced.
- **Loosening validation**: accepting documents that were previously
  rejected.
- **Clarifications** of behavior that was previously unspecified, together
  with a conformance case pinning it.

Consequences users should understand:

- A Testfile using a newly added field requires a runner that already knows
  it — older runners **reject** it (`additionalProperties: false` makes
  unknown fields hard errors by design, so typos and too-old runners fail
  loudly instead of silently ignoring configuration).
- A runner update never changes the outcome of an existing, valid Testfile.

## Changes that require version 2

Anything that would make an existing valid document invalid or change what
it does:

- Removing or renaming a field, or changing a field's type or shape.
- Changing a default value or making an optional field required.
- **Tightening validation** so previously valid documents are rejected.
- Changing execution semantics: ordering, status aggregation, skip/failure
  propagation, environment precedence, readiness or shutdown behavior —
  anything observable by the [conformance suite](../conformance/README.md).

## How version 2 will be introduced

- The JSON schema keeps its stable `$id` and will validate **all supported
  major versions** (dispatching on `version`), so editors keep working with
  one schema URL.
- Runners must **reject unknown versions** with a clear error naming the
  highest version they support — never attempt a best-effort run.
- Version 1 support in the reference runner is maintained for at least one
  year after version 2 ships; `testfile migrate` tooling is expected to
  accompany the release.
- The conformance suite gains a `v2/` case tree; existing v1 cases are
  frozen and keep running against v1 documents.

## Deprecation process

Within a major version nothing is removed. A field slated for replacement
is:

1. marked deprecated in the spec, the schema `description` and the docs,
   with the replacement named;
2. kept fully functional for the remainder of the major version;
3. removed only in the next major version, listed in its migration notes.

## What is *not* covered by this policy

- **Runner features** (CLI flags, TUI behavior, run-history layout under
  `.testfile/`, reporter formats) may evolve independently of the format
  version; the run-record JSON used by the conformance contract only grows
  backward-compatibly.
- **The schema file itself** may be refactored (descriptions, `$defs`
  layout) at any time as long as the set of accepted documents is unchanged.

## Enforcement

- Every semantic change lands with a conformance case; CI runs the suite on
  every push.
- The schema's example corpus (`schema/tests/valid`, `schema/tests/invalid`)
  is append-only within a major version: a schema change that breaks an
  existing valid example is by definition a breaking change and must be
  rejected or deferred to the next major version.
