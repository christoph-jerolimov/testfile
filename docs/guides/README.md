# Guides

Complete, working Testfiles for common stacks. Copy one into your project,
adjust the commands, run `testfile start`.

Each guide is a folder: an `index.mdx` with the prose, published on the
website under [`/guides/`](https://testfile.dev/guides/pytest-postgres), next
to the example files it embeds — the page quotes the real `Testfile` from the
folder through the website's `<Snippet>` component
([`website/src/components/Snippet.tsx`](../../website/src/components/Snippet.tsx)),
so a guide can never drift from the file it shows. The Testfiles are
validated against the schema by the repository's own CI.

| Guide | Stack | Shows |
| ----- | ----- | ----- |
| [`pytest-postgres`](./pytest-postgres/) | Python | Container service with `exec` readiness, migrations in `setup`, random port |
| [`playwright-web`](./playwright-web/) | JavaScript | API + frontend as process services, HTTP readiness, artifacts, retries |
| [`go-containers`](./go-containers/) | Go | Redis and Kafka containers with `tcp`/`log` readiness, `inputs` caching |
| [`node-matrix`](./node-matrix/) | Any | Matrix across Node and PostgreSQL versions with `exclude` |
| [`monorepo`](./monorepo/) | Any | Glob `include` of per-package Testfiles |
| [`three-platforms`](./three-platforms/) | GitHub Actions | Guided tour: one Testfile on Linux, macOS and Windows, merged into a single run |

The commands inside them refer to files these folders do not contain (they
are recipes, not runnable projects) — `testfile validate` passes, `testfile
run` expects your project.
