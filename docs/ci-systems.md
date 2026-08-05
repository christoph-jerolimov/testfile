---
title: Other CI systems
order: 10
description: Run a Testfile on GitLab CI, Jenkins, CircleCI or Buildkite — and bring those runs home.
---

# Other CI systems

A Testfile is a plain command: `testfile run`. Any CI system that can run a
shell command can run your suite, and because the runner owns services,
parallelism and matrices, the pipeline stays a single job instead of a
translation of your test setup into that system's YAML dialect.

The [GitHub Action](./github-action) adds annotations, a job summary and
artifact upload on top. For everything else, copy one of the templates in
the repository's
[`ci/` folder](https://github.com/christoph-jerolimov/testfile/tree/main/ci):

| System | Template |
| ------ | -------- |
| GitLab CI | [`ci/.gitlab-ci.yml`](https://github.com/christoph-jerolimov/testfile/blob/main/ci/.gitlab-ci.yml) |
| Jenkins | [`ci/Jenkinsfile`](https://github.com/christoph-jerolimov/testfile/blob/main/ci/Jenkinsfile) |
| CircleCI | [`ci/.circleci-config.yml`](https://github.com/christoph-jerolimov/testfile/blob/main/ci/.circleci-config.yml) |
| Buildkite | [`ci/buildkite-pipeline.yml`](https://github.com/christoph-jerolimov/testfile/blob/main/ci/buildkite-pipeline.yml) |

They all follow the same three steps:

```sh
npm ci --no-audit --no-fund
npx --yes @testfile/runner run --reporter junit --output junit.xml
# then: publish junit.xml, archive .testfile/runs/
```

Two things are worth wiring up in every system:

- **`junit.xml`** feeds the system's own test reporting.
- **`.testfile/runs/`** is the recorded run — `run.yaml`, per-test logs,
  service logs, collected artifacts. Archiving it is what makes a CI run
  inspectable later, locally, in the same viewer as your own runs.

## Bringing runs home

For GitLab, the viewer speaks the API directly:

```sh
export GITLAB_TOKEN=...                     # a token with read_api
testfile-viewer gitlab list group/project   # what is available
testfile-viewer gitlab sync group/project   # import the latest pipelines
testfile-viewer runs                        # they are part of the history now
```

`--job <name>` selects the job whose artifacts hold the run (default
`testfile`), `--latest <n>` how many pipelines to consider, `--ref <branch>`
narrows to one branch, and `--host https://gitlab.example.com` points at a
self-hosted instance. On GitHub, the equivalent is
[`testfile-viewer github sync`](./github-action#bringing-ci-runs-home).

For Jenkins, CircleCI, Buildkite — or any system whose artifacts you
download by hand — import the downloaded archive:

```sh
testfile-viewer archive import testfile-runs.zip
```

Both `.zip` (what CI systems produce) and `.tgz` (what
`testfile-viewer archive pack` produces) work, and runs that already exist
locally are skipped, so repeated imports are safe.

## Sharing through a bucket

Independent of the CI system, a pipeline can push its run to S3 and
developers can pull it:

```sh
testfile-viewer s3 push s3://my-bucket/testfile-runs   # in the pipeline
testfile-viewer s3 list s3://my-bucket/testfile-runs   # locally
testfile-viewer s3 pull s3://my-bucket/testfile-runs
```

This uses the `aws` CLI, so it works with any S3-compatible endpoint the
CLI is configured for (`AWS_ENDPOINT_URL`), including MinIO and Cloudflare
R2. GCS and Azure have no dedicated backend yet; `archive pack` plus that
provider's own upload command achieves the same in two lines.
