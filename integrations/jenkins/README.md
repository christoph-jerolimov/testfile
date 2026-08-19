# Testfile for Jenkins

A [Jenkins shared library](https://www.jenkins.io/doc/book/pipeline/shared-libraries/)
with a single `testfile` step: run the tests a `Testfile` describes from a
pipeline, the way the [GitHub Action](../../action.yml) runs them on GitHub —
options map to runner flags, the JUnit report is recorded, the recorded run
(`.testfile/runs/<id>`) is archived as a build artifact, and the run is
labelled with the Jenkins context so it stays findable in the viewer.

## Installing the library

**Manage Jenkins → System → Global Trusted Pipeline Libraries** (or the
equivalent [JCasC](test/jenkins-casc.yaml) block):

- Name: `testfile`
- Default version: `main`
- Retrieval method: *Modern SCM* → *Git* →
  `https://github.com/testfile-dev/testfile` with *Library path*
  `integrations/jenkins` — or point it at a clone/mirror of this folder.

Required plugins: `workflow-aggregator` (Pipeline), `junit`, `git`. The
agent that runs the step needs Node.js ≥ 20 on its `PATH`; the runner
itself is fetched by `npx` on first use.

## Using the step

```groovy
@Library('testfile') _
node {
  checkout scm
  testfile()
}
```

or with options, which mirror the GitHub Action's inputs:

```groovy
testfile path: 'services',
         filterTags: ['fast', 'integration'],
         failFast: true,
         variants: [platform: 'linux'],
         labels: [tier: 'nightly'],
         doctor: true
```

| Option | Meaning | Default |
| ------ | ------- | ------- |
| `path` | Testfile or directory containing one | `.` |
| `filter`, `filterName`, `filterTags`, `filterMatrix` | test selection (`-f`, `-n`, `-t`, `-m`) | – |
| `failFast` | abort the whole run at the first failure | `false` |
| `maxParallel` | global cap on concurrently running tests | – |
| `variants` | what distinguishes this run from other legs of a matrix (map or `key=value` list); `testfile-viewer merge` needs it | – |
| `labels` | extra labels recorded with the run; explicit labels win over automatic ones | – |
| `autoLabels` | label the run with the Jenkins context: `branch`, `job`, `sha`, `ci-run`, `node` | `true` |
| `reporter` / `output` | machine-readable report | `junit` / `testfile-junit.xml` |
| `junit` | record the report with the `junit` step | `true` when the reporter is junit |
| `archiveRuns` | archive `.testfile/runs/**` | `true` |
| `doctor` | run `testfile doctor` first and fail early with a readable report | `false` |
| `runnerCommand` | the runner to invoke | `npx --yes @testfile.dev/runner` |

The archived run can be pulled into a local history with
`testfile-viewer archive import <downloaded-artifact>`.

> Until `@testfile.dev/runner` is published to npm, the default
> `runnerCommand` cannot resolve — the same caveat as the snippets in
> [`ci/`](../../ci). Point `runnerCommand` at a checkout's built CLI in the
> meantime.

## Testing the library

The [`Testfile`](Testfile) in this folder is the library's own test suite:
it starts real Jenkins controllers as container services — a matrix over
the most common LTS versions plus `latest` — seeds each with the library
and three pipeline jobs, then triggers those jobs over the REST API and
asserts their verdicts, JUnit results and archived artifacts.

```sh
testfile start integrations/jenkins            # all Jenkins versions
testfile start integrations/jenkins -m jenkins:lts   # one leg
testfile start integrations/jenkins --max-parallel 2 # easy on small machines
```

How a leg is wired, without mounting anything into the container (a
Testfile cannot know an absolute host path to mount):

1. `src-server` (a host-side service, [`test/serve.mjs`](test/serve.mjs))
   serves this folder as a tarball.
2. Each Jenkins container runs with host networking on its own port, and
   its command fetches the tarball and hands over to
   [`test/container-init.sh`](test/container-init.sh): install the pinned
   plugin set with `jenkins-plugin-cli`, install Node.js into
   `$JENKINS_HOME/tools/node`, commit the library as a local git repo
   (Jenkins loads libraries from SCM only), then start Jenkins with
   [JCasC](test/jenkins-casc.yaml) — which registers the library and seeds
   the jobs from [`test/jobs.groovy`](test/jobs.groovy).
3. The three jobs copy a fixture suite from
   [`test/fixtures`](test/fixtures) into their workspace and call the
   `testfile` step: `testfile-smoke` must succeed with JUnit results and an
   archived run, `testfile-filtered` proves `filterTags` keeps a failing
   test out, `testfile-failing` must fail the build while still recording
   the report.
4. [`test/verify.mjs`](test/verify.mjs) triggers each job and asserts all
   of that; failed builds' console logs land in the run's artifacts.

The suite needs a local container engine (podman or docker) with host
networking and network access (Docker Hub, the Jenkins update center,
nodejs.org, npm) — it is CI-shaped, sized for `ubuntu-latest`-class
runners. Ports 18080–18083 must be free.
