# Testfile specification

Three normative documents, one per question: how a project *describes* its
tests, what a runner *writes down* about a run, and how either of those is
allowed to change.

| Document | What it specifies |
| -------- | ----------------- |
| [TESTFILE.md](TESTFILE.md) | **The Testfile format** — the input. The YAML a project writes: tests, groups, matrices, services, ports, templates, caching, and what running them means. |
| [RESULTS.md](RESULTS.md) | **The test result format** — the output. The run folder a runner records: `run.yaml`, the logs and artifacts beside it, and what a viewer may assume about them. |
| [VERSIONING.md](VERSIONING.md) | **The versioning policy** — how both formats evolve: what may change inside a format version, what forces the next one, and what runners and users can rely on. |

The two formats are deliberately independent. A runner reads the first and
writes the second; a viewer — a CLI, a TUI, a web UI, CI tooling — only ever
reads the second and never learns which runner produced it.

## What backs them up

- **Machine-readable counterparts** live in [`../schema/`](../schema/):
  [`testfile.schema.json`](../schema/testfile.schema.json) for the format,
  [`testrun.schema.json`](../schema/testrun.schema.json) for `run.yaml`. Where
  a schema and a specification disagree, the specification wins and the schema
  has a bug.
- **Execution semantics** are pinned by the runner-independent
  [conformance suite](../conformance/README.md). Every change to TESTFILE.md
  adds or adjusts a case, and an implementation claims compatibility by
  passing the whole suite.

## Status

**Version 0, under review.** The format may still change based on feedback;
version 1 — the first with stability guarantees — is targeted for Q4 2026.
That makes this the cheap moment to fix mistakes: if a field name feels
wrong, a default surprises you or something is missing, please say so in a
[GitHub issue](https://github.com/christoph-jerolimov/testfile/issues).

All three documents are published on the website as verbatim copies, under
[/spec](https://christoph-jerolimov.github.io/testfile/spec/testfile).
