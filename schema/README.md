# @testfile.dev/schema

The JSON schema for the
[Testfile](https://github.com/christoph-jerolimov/testfile) format —
[`testfile.schema.json`](testfile.schema.json), the machine-readable
counterpart of the normative [specification](../spec/TESTFILE.md) (if the two
disagree, the spec wins and the schema has a bug).

Use it in any editor with a YAML language server by adding a modeline as the
first line of your Testfile:

```yaml
# yaml-language-server: $schema=https://raw.githubusercontent.com/christoph-jerolimov/testfile/main/schema/testfile.schema.json
```

Or programmatically — the package's only export is the schema itself:

```js
import schema from "@testfile.dev/schema" with { type: "json" };
```

`tests/valid/` and `tests/invalid/` hold the example corpus: every valid file
must pass validation and every invalid one must be rejected (`npm test` runs
[`scripts/validate.mjs`](scripts/validate.mjs) over both, plus the
repository's own root `Testfile`). The corpus is append-only within a major
format version — see the [versioning policy](../spec/VERSIONING.md).
