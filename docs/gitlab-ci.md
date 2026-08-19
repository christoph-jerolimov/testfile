---
title: GitLab CI
order: 2
category: Run tests
description: Run your Testfile in GitLab CI with one include.
---

# GitLab CI

The repository ships a GitLab CI template — the GitLab counterpart of the
[GitHub Action](./github-action) — so running a Testfile in a pipeline is a
single include:

```yaml
include:
  - remote: https://raw.githubusercontent.com/testfile-dev/testfile/main/gitlab/testfile.gitlab-ci.yml
```

That adds a `testfile` job to the pipeline: it runs
[`testfile doctor`](./cli#checking-the-machine) and then `testfile start`
against your repository's Testfile, in a `node:22` container. The job fails
when tests fail; the JUnit report it writes feeds GitLab's own test
reporting, so failed tests appear in the merge request widget and the
pipeline's **Tests** tab — that is the GitLab shape of what annotations,
the job summary and the per-test commit statuses do on GitHub. The
recorded run is kept as a job artifact.

## Variables

The job is configured with `TESTFILE_*` variables — set them on the job,
the pipeline, or in a `rules:` entry:

```yaml
testfile:
  variables:
    TESTFILE_FILTER_TAGS: fast
    TESTFILE_FAIL_FAST: "true"
```

| Variable | Default | Description |
| -------- | ------- | ----------- |
| `TESTFILE_PATH` | `.` | Testfile or directory containing one. |
| `TESTFILE_FILTER` / `TESTFILE_FILTER_NAME` / `TESTFILE_FILTER_TAGS` / `TESTFILE_FILTER_MATRIX` | – | Same as the `-f`/`-n`/`-t`/`-m` [CLI filters](./cli#filtering). |
| `TESTFILE_CHANGED` | `false` | Run only tests whose `inputs` match files [changed against the base branch](./writing-tests#change-based-selection) (`--changed`). |
| `TESTFILE_CHANGED_SINCE` | MR target branch | Base branch for `changed`. Defaults to `$CI_MERGE_REQUEST_TARGET_BRANCH_NAME`, so on merge request pipelines the diff is against the MR's target branch. The job fetches it itself. |
| `TESTFILE_FAIL_FAST` | `false` | Abort the whole run at the first failure. |
| `TESTFILE_MAX_PARALLEL` | – | Global cap on concurrently running tests. |
| `TESTFILE_REPORTER` / `TESTFILE_OUTPUT` | `junit` / `junit.xml` | [Machine-readable results](./cli#machine-readable-reports). The defaults are what GitLab's test reporting reads; changing them means overriding the job's `artifacts` to match. |
| `TESTFILE_NODE_IMAGE` | `node:22` | Image the job runs in. Needs bash, git and npm — any `node:*` image has all three. |
| `TESTFILE_DOCTOR` | `true` | Run [`testfile doctor`](./cli#checking-the-machine) before the tests: every missing tool, engine or taken port that would fail the run anyway fails early, in one readable report. |
| `TESTFILE_VARIANTS` | – | What tells this run apart from the other legs of a matrix, as `key=value` pairs separated by commas or newlines (e.g. `node=22`; whitespace is stripped, so values cannot contain spaces). Recorded in `run.yaml`; [merging](./cli#merging-runs) needs it. |
| `TESTFILE_LABELS` | – | Extra [labels](./cli#labelling-runs) to record, as `key=value` pairs separated by commas or newlines (e.g. `tier=nightly, owner=infra`). Merged with the automatic ones; a key you set yourself wins. |
| `TESTFILE_AUTO_LABELS` | `true` | Label the run with the GitLab context — see below. |

The template also defines a hidden `.testfile` job; `extends: .testfile`
derives more jobs from it (a nightly one, one per package) without
touching the default `testfile` job.

## What a CI run is labelled with

Every run the job records is labelled with where it came from, so a
history collected from many pipelines can be narrowed down afterwards
(`testfile serve` filters by label). The keys match what the
[GitHub Action](./github-action#what-a-ci-run-is-labelled-with) records,
so runs from both forges sit in one history:

| Key | Value |
| --- | ----- |
| `trigger` | how the pipeline started: `manual` (a `web`, `api` or `trigger` pipeline), `schedule`, `push`, `merge_request`, or GitLab's own name for any other source |
| `branch` | the branch the run used — on a merge request the **source** branch |
| `base` | merge requests only: the **target** branch |
| `mr` | merge requests only: the merge request number (`pr` on GitHub) |
| `tag` | tag pipelines only, instead of `branch` |
| `actor` | the GitLab username that started the pipeline |
| `repo` | the project path (`group/project`) |
| `job` | the job name — with `parallel: matrix:`, GitLab includes the leg's values, so the legs stay distinguishable |
| `sha` | the short commit sha |
| `ci-run` | the pipeline id, to get from a recorded run back to its pipeline |

A label is only recorded when the context supplies it, so a run never
carries an empty one. Your own `TESTFILE_LABELS` win over the automatic
ones — setting `branch=release` replaces the derived value rather than
clashing with it. Set `TESTFILE_AUTO_LABELS: "false"` to record only your
own.

## Examples

Only the fast tests on merge requests, everything nightly, the full suite
on the default branch — `rules:` picks the variables per pipeline:

```yaml
testfile:
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
      variables:
        TESTFILE_FILTER_TAGS: fast
        TESTFILE_FAIL_FAST: "true"
    - if: $CI_PIPELINE_SOURCE == "schedule"
      variables:
        TESTFILE_FILTER_TAGS: nightly
    - if: $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH
```

Only the tests a merge request could have affected, diffed against the
MR's target branch (note `GIT_DEPTH: "0"` — change detection diffs
against the base branch, which a shallow clone doesn't reach):

```yaml
testfile:
  variables:
    GIT_DEPTH: "0"
    TESTFILE_CHANGED: "true"
```

Tests without [`inputs`](./writing-tests#result-caching) always run, so a
suite adopts this incrementally: declare `inputs` on the expensive tests
first.

More than one leg — GitLab's `parallel: matrix:` runs the job once per
combination, and `TESTFILE_VARIANTS` is what tells the recorded runs
apart when [`testfile merge`](./cli-reference#testfile-merge-run)
combines them (job artifacts are per job, so nothing overwrites):

```yaml
testfile:
  parallel:
    matrix:
      - TESTFILE_NODE_IMAGE: ["node:20", "node:22"]
  variables:
    TESTFILE_VARIANTS: node=$TESTFILE_NODE_IMAGE
```

## Container services

Unlike GitHub's runners, a GitLab job does not come with a container
engine: the [engine selection](./services#containers) needs a docker
client in the job's image and a daemon it can reach. On a runner that
allows docker-in-docker, that is one service and one download:

```yaml
testfile:
  services:
    - docker:dind
  variables:
    DOCKER_HOST: tcp://docker:2375
    DOCKER_TLS_CERTDIR: ""
  before_script:
    - curl -fsSL https://download.docker.com/linux/static/stable/x86_64/docker-27.5.1.tgz | tar -xz --strip-components=1 -C /usr/local/bin docker/docker
```

On a shell executor or a runner whose host docker socket is mounted, the
client alone is enough. Testfiles whose services are plain processes need
none of this.

## Bringing CI runs home

Every run of the job keeps the recorded run folder (`.testfile/runs/<id>`)
as a job artifact, for two weeks by default (`expire_in` on the job
changes that). `testfile gitlab sync` downloads the artifacts of the
latest pipelines and imports them into your local
[run history](./cli#run-history), where `testfile runs`, `inspect run`,
`diff`, `--flaky` and the TUI's runs/tests views treat them like local
runs:

```sh
export GITLAB_TOKEN=...              # a token with read_api
testfile gitlab sync group/project   # import the latest pipelines
testfile runs                        # CI runs are now part of the history
```

It looks for a job named `testfile` — the template's default — and
`--job <name>` selects another (a job derived with `extends: .testfile`,
say). `--latest <n>` sets how many pipelines to consider, `--ref <branch>`
narrows to one branch, and `--host https://gitlab.example.com` points at a
self-hosted instance — the template itself has no GitLab.com dependency
beyond where it is included from, so it works there unchanged. A manually
downloaded artifact zip imports with `testfile archive import`; see
[sharing runs](./cli#sharing-runs) for the underlying commands and the S3
variant.

## Without the template

The template is a convenience, not a requirement — a Testfile suite is one
command, so a job you write yourself stays three lines. The
[`ci/` folder](https://github.com/testfile-dev/testfile/tree/main/ci) has
that spelled out for GitLab and the [other CI systems](./ci-systems),
including what to archive so the runs stay inspectable later.
