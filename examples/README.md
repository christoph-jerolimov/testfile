# Examples

Complete, working Testfiles for common stacks. Copy one into your project,
adjust the commands, run `testfile start`.

| Example | Stack | Shows |
| ------- | ----- | ----- |
| [`pytest-postgres`](./pytest-postgres/) | Python | Container service with `exec` readiness, migrations in `setup`, random port |
| [`playwright-web`](./playwright-web/) | JavaScript | API + frontend as process services, HTTP readiness, artifacts, retries |
| [`go-containers`](./go-containers/) | Go | Redis and Kafka containers with `tcp`/`log` readiness, `inputs` caching |
| [`node-matrix`](./node-matrix/) | Any | Matrix across Node and PostgreSQL versions with `exclude` |
| [`monorepo`](./monorepo/) | Any | Glob `include` of per-package Testfiles |

They are rendered on the
[examples page](https://christoph-jerolimov.github.io/examples) of
the website and validated against the schema by the repository's own CI, so
they never drift from the current format.

The commands inside them refer to files these folders do not contain (they
are recipes, not runnable projects) — `testfile validate` passes, `testfile
run` expects your project.
