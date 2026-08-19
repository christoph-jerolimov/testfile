---
title: Tekton
order: 3
category: Run tests
description: Run your Testfile as a Tekton Task — with the services as pods on the same cluster.
---

# Tekton

The [`tekton/` folder](https://github.com/testfile-dev/testfile/tree/main/tekton)
of the repository holds the [GitHub Action](./github-action)'s sibling for
Kubernetes-native CI: a reusable
[Tekton](https://tekton.dev/) Task. Install it once per namespace, then
running a Testfile is a single task in any pipeline:

```sh
kubectl apply -f https://raw.githubusercontent.com/testfile-dev/testfile/main/tekton/testfile-task.yaml
```

```yaml
  tasks:
    - name: test
      runAfter: [fetch]
      taskRef:
        name: testfile
      workspaces:
        - name: source
          workspace: source
```

The task fetches the runner with npx and executes `testfile start` against
the `source` workspace — the checkout a `git-clone` task produced. The
TaskRun fails when tests fail. Because the runner owns services,
parallelism and matrices, the pipeline stays this one task instead of a
translation of your test setup into Tekton YAML.
[`tekton/testfile-pipeline.yaml`](https://github.com/testfile-dev/testfile/blob/main/tekton/testfile-pipeline.yaml)
is a complete clone-then-test pipeline to start from.

## Services run on the cluster

On GitHub's runners the services a Testfile declares run on docker. A
Tekton step is already a container, with no docker beside it — but it has
something better: the cluster itself. The task pins
`TESTFILE_ENGINE=kubernetes`, so the runner's
[kubernetes engine](./services#containers) starts each service as a pod in
the TaskRun's own namespace, wires service-to-service DNS, forwards the
declared ports to localhost, and tears everything down at the end. The
Testfile stays engine-neutral: the same file runs its postgres on docker on
a laptop and as a pod on the cluster in CI.

Two things make that work:

- **kubectl.** The engine drives everything through it, and the default
  `node` image has none — so a first step downloads a static kubectl into a
  shared volume (pin it with `kubectl-version`). On an air-gapped cluster,
  use an `image` with kubectl baked in; the step then skips the download.
- **Permissions.** Creating pods is a write to the cluster, which the
  default ServiceAccount may not have.
  [`tekton/testfile-rbac.yaml`](https://github.com/testfile-dev/testfile/blob/main/tekton/testfile-rbac.yaml)
  is the exact grant: a `testfile` ServiceAccount allowed to create pods
  and services in the pipeline's namespace (plus reading kube-system's
  services, which `kubectl cluster-info` — the engine probe — needs). Run
  the pipeline with `taskRunTemplate.serviceAccountName: testfile`, or
  `tkn pipeline start -s testfile`.

A Testfile without container services needs neither — the task runs with
any ServiceAccount and never looks for kubectl.

## Parameters

| Parameter | Default | Description |
| --------- | ------- | ----------- |
| `path` | `.` | Testfile or directory containing one, relative to the workspace. |
| `filter` / `filter-name` / `filter-tags` / `filter-matrix` | – | Same as the `-f`/`-n`/`-t`/`-m` [CLI filters](./cli#filtering). |
| `changed` | `false` | Run only tests whose `inputs` match files [changed against the base branch](./writing-tests#change-based-selection) (`--changed`). Needs history in the checkout — set the clone's depth to 0. |
| `changed-since` | – | Base branch/ref for `changed`, e.g. `origin/main`. |
| `fail-fast` | `false` | Abort the whole run at the first failure. |
| `max-parallel` | – | Global cap on concurrently running tests. |
| `shard` | – | Run only this shard of the selected tests, e.g. `2/4` — for splitting one suite across parallel TaskRuns. |
| `reporter` / `output` | – | Write [machine-readable results](./cli#machine-readable-reports) (`junit` or `json`) to a file in the workspace. |
| `doctor` | `true` | Run [`testfile doctor`](./cli#checking-the-machine) first: every missing tool, engine or taken port that would fail the run anyway fails early, in one readable report. |
| `engine` | `kubernetes` | Container engine for the declared services. Empty auto-detects — which inside a step pod still means kubernetes, there is no docker to find. |
| `kubectl-version` | `stable` | kubectl to download when the image has none; a pinned `v1.31.0` beats resolving `stable` on every run. |
| `image` | `node:22` | Image the steps run in — needs node and npm (and curl, to fetch kubectl). |
| `variants` | `[]` | What tells this run apart from the other legs of a matrix, as `key=value` pairs (array parameter). Recorded in `run.yaml`; [merging](./cli#merging-runs) needs it. |
| `labels` | `[]` | Extra [labels](./cli#labelling-runs) to record, as `key=value` pairs (array parameter). A key you set yourself wins over an automatic one. |
| `auto-labels` | `true` | Label the run with the Tekton context — see below. |

Two results come back: `outcome` (`passed` or `failed` — useful in a
`finally` task, which runs on failure too) and `run-id`, the id of the
recorded run under `.testfile/runs/` in the workspace, so a later task can
pack or upload exactly this run.

## What a run is labelled with

Like the action, the task labels every recorded run with where it came
from, so a history that collects runs from many pipelines can be narrowed
down afterwards (`testfile serve` filters by label):

| Key | Value |
| --- | ----- |
| `ci` | `tekton` |
| `ci-run` | the TaskRun name, to get from a recorded run back to its logs |
| `namespace` | the namespace the run happened in |

Tekton injects no git context into a task, so branch and commit labels are
the pipeline's to pass — the clone task knows them:

```yaml
      params:
        - name: labels
          value:
            - branch=$(params.revision)
            - sha=$(tasks.fetch.results.commit)
```

## Bringing runs home

The recorded run — `run.yaml`, per-test logs, service logs, collected
artifacts — lands in `.testfile/runs/` on the `source` workspace. Back it
with a PVC (a `volumeClaimTemplate` in the PipelineRun) and it survives the
pod, but Tekton has no artifact store to browse it in. The S3 route fits
Tekton best: one more task behind `test`, running on failure too, pushing
the run to a bucket —

```yaml
    - name: upload-run
      runAfter: [test]
      taskRef:
        name: testfile-upload   # or an inline taskSpec around these commands
      # push the run whether the tests passed or not - the interesting run
      # is the one that failed
      params:
        - name: script
          value: |
            npx --yes @testfile.dev/runner s3 push s3://my-bucket/testfile-runs
      workspaces:
        - name: source
          workspace: source
```

— and on a laptop the same bucket is the [run history](./cli#run-history):

```sh
testfile s3 pull s3://my-bucket/testfile-runs
testfile runs        # CI runs are now part of the history
```

Any S3-compatible endpoint the `aws` CLI reaches works, including MinIO on
the same cluster (`AWS_ENDPOINT_URL`). Without a bucket,
`testfile archive pack` in a follow-up task produces a single `.tgz` on the
workspace to copy out however you like, and `testfile archive import`
ingests it locally — see [sharing runs](./cli#sharing-runs).

## More than one leg

`shard` splits one suite across parallel TaskRuns
(`shard: 1/3` … `3/3`), and Tekton's
[`matrix`](https://tekton.dev/docs/pipelines/matrix/) turns that into one
pipeline task:

```yaml
    - name: test
      taskRef:
        name: testfile
      matrix:
        params:
          - name: shard
            value: ["1/2", "2/2"]
```

Each leg records its shard as a variant (`shard=1/2`) on its own — inside a
matrix no other parameter can tell the legs apart — so
[`testfile merge`](./cli-reference#testfile-merge-run) can unite the
recorded runs into a single verdict later, exactly as with the action's
platform matrix.

Test bodies with a [`container:`](./writing-tests#running-a-test-in-a-container)
are the one thing the kubernetes engine does not cover — a body container
runs locally, next to the runner, and a step pod has no engine for it. Keep
test bodies plain commands (the step's `image` is the environment they run
in) and leave containers to the services.
