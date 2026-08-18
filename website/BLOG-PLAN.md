# Blog plan for testfile.dev

A content plan for a blog section on the website. The website currently
renders `docs/`, `examples/` and `spec/`; a blog would be a fourth Astro
content collection (`website/src/pages/blog/`, fed from a `blog/` folder,
same pattern as the docs). This document is the editorial plan: what to
write, in which series, and in which order.

## Goals

1. **Get people to a first successful run fast.** Docs explain; blog posts
   *walk through* — one stack, one outcome, copy-paste-able.
2. **Get Testfile tested.** The format is `version: 0` and under review,
   with version 1 targeted for Q4 2026. Posts should actively recruit
   readers to run Testfile against their real projects and report what
   broke — the blog is a feedback channel, not just marketing.
3. **Show depth over time.** Recorded runs, diffs, flaky verdicts, sync,
   sharding, Kubernetes — features that don't fit a landing page get one
   post each.

Each post ends with the same two calls to action: *try it on your project*
(`testfile init` or the [wizard](https://testfile.dev/start)) and *tell us
what didn't work* (link to GitHub issues, labelled `v0-feedback`).

Difficulty labels used below: **[E]** easy, **[I]** intermediate,
**[A]** advanced.

---

## Series 1 — "Your first Testfile" (easy, launch series)

Short onboarding posts. One concept per post, under 5 minutes of reading,
every snippet runnable.

| # | Title | Level | Core content |
|---|-------|-------|--------------|
| 1.1 | Introducing Testfile: one file that runs your tests everywhere | [E] | The elevator pitch: same file on every laptop and every CI. The three ideas (tests nest, tests need services, the environment is explicit). Ends with the 10-line hello-world Testfile. |
| 1.2 | From zero to green in five minutes | [E] | `testfile init` on an existing project vs. the wizard vs. writing the file by hand. First `testfile run`, reading the output. |
| 1.3 | You already have a Testfile — it's just spread across five files | [E] | How `init` imports package.json scripts, docker-compose, Makefiles and GitHub workflows. Before/after on a messy real project. |
| 1.4 | Will it run here? `testfile doctor` before the run finds out | [E] | Checking a machine against what the file needs: engines, ports, commands. Great "help us test" post — doctor output is exactly the feedback we want. |
| 1.5 | Services: a database for your tests, without the README ritual | [E] | Declaring postgres as a container service with a readiness check; `${{ ports.db }}`. The "no more 'start docker first' paragraph in the README" story. |

## Series 2 — "Recipes" (easy→intermediate, evergreen)

One post per stack, each backed by a folder in `examples/` so the code is
CI-tested and can't rot. The five existing examples map 1:1 to the first
five posts; later recipes should add their example folder first.

| # | Title | Level | Backed by |
|---|-------|-------|-----------|
| 2.1 | Testing a Python app against real Postgres | [E] | `examples/pytest-postgres` |
| 2.2 | Playwright end-to-end tests, self-contained | [E] | `examples/playwright-web` — app service, `ready: http`, `BASE_URL` from a random port |
| 2.3 | Go services with containers | [I] | `examples/go-containers` |
| 2.4 | One suite, four Node versions: the matrix | [I] | `examples/node-matrix` |
| 2.5 | A monorepo with per-package Testfiles | [I] | `examples/monorepo` — `include`, `foreach` |
| 2.6 | Rails + Redis + Sidekiq (new example) | [I] | new `examples/` folder |
| 2.7 | Testing against Kafka (or another broker) | [I] | new `examples/` folder |
| 2.8 | Running the test body itself in a container | [I] | container test bodies — "my laptop has no Python 3.9" |

## Series 3 — "One file, every CI" (intermediate)

The portability story — the reason the format exists.

| # | Title | Level | Core content |
|---|-------|-------|--------------|
| 3.1 | The GitHub Action: annotations, summaries, and a status per test | [I] | `action/` setup, PR annotations, per-test commit statuses, uploading the run as an artifact. |
| 3.2 | Same Testfile on GitLab, Jenkins, Buildkite and CircleCI | [I] | The ready-made snippets from `docs/ci-systems.md`; the point is that the CI config shrinks to "run testfile". |
| 3.3 | Guided tour: Linux, macOS and Windows, merged into one run | [I] | Blog version of `docs/three-platforms.md` — three legs, `testfile` merge, one verdict. This repo's own CI as the worked example. |
| 3.4 | Shard your suite across machines with `--shard i/n` | [A] | Cutting wall-clock time; how sharding interacts with the matrix and with merging. |
| 3.5 | Ports that never collide: how random port allocation makes CI parallel-safe | [I] | Named ports, per-run allocation, `${{ ports.* }}` templating — the mechanics behind "parallel runs don't fight". |

## Series 4 — "Your runs are data" (intermediate→advanced)

Everything downstream of a run: the recorded-run domain that most test
runners don't have. This is Testfile's most differentiated territory.

| # | Title | Level | Core content |
|---|-------|-------|--------------|
| 4.1 | Every run is recorded: inside `run.yaml` | [I] | The results format (`spec/RESULTS.md` for humans), per-test logs, timings, service logs, the timeline. |
| 4.2 | The terminal UI and the web viewer | [I] | Browsing runs, filters by label/status/variant, the timeline view. Screenshot-heavy. |
| 4.3 | "What changed?" — diffing two runs | [I] | Run diffs: new failures vs. fixed vs. still-broken; using a diff in a PR review. |
| 4.4 | Flaky or broken? Verdicts from run history | [A] | How flaky/broken verdicts are computed across the history; acting on a flaky verdict instead of retrying forever. |
| 4.5 | Runs travel: archives, S3, and pulling straight from CI | [A] | `testfile-ts/sync`: pack/push/pull, syncing from GitHub Actions and GitLab CI to a laptop, then viewing locally. |
| 4.6 | Re-run exactly what failed: `--failed`, `--changed`, and repro bundles | [I] | Git-aware selection, repro bundles for handing a failure to a teammate. |

## Series 5 — "The format, in depth" (advanced)

For people already running Testfile who want to use the whole format.

| # | Title | Level | Core content |
|---|-------|-------|--------------|
| 5.1 | Matrix deep dive: sharing service instances across combinations | [A] | Expansion rules, `${{ matrix.* }}`, one database instance serving a whole matrix, filtering by matrix value. |
| 5.2 | DAG ordering with `needs`, and when *not* to use it | [A] | Sequence/parallel vs. explicit `needs`; setup/teardown hooks. |
| 5.3 | Caching test results by declared `inputs` | [A] | The cache model, `--dry-run` as a cache probe, honest caveats about when caching lies to you. |
| 5.4 | Secrets, `forwardEnv`, and the isolated environment | [A] | Why the environment is closed by default; first-class secrets with masking; env files. |
| 5.5 | Conditions, tags, timeouts, retries, `continueOnError` | [I] | The control-flow toolbox in one post, with a decision table. |
| 5.6 | Your tests on a Kubernetes cluster, ports forwarded home | [A] | The k8s engine: pods instead of local containers, same file, engine chosen by the runner not the file. |

## Series 6 — "Under the hood" (advanced, engineering-blog flavour)

Posts that build trust with tool-builders and attract contributors. These
also serve goal 2: the spec and conformance suite are *how* outsiders test
Testfile itself.

| # | Title | Level | Core content |
|---|-------|-------|--------------|
| 6.1 | Why Testfile has a normative spec — and a conformance suite | [A] | `spec/` + `conformance/`: the format is pinned so other runners can implement it; how to run the conformance suite against a runner. |
| 6.2 | The road to version 1 | [E] | What "version: 0, under review" means, what's open for change, how to file feedback that shapes v1 (Q4 2026). **Publish early; pin it.** |
| 6.3 | A JSON schema is a UI: validation and completion in your editor | [I] | `schema/`, the VS Code extension, run-from-editor. |
| 6.4 | An MCP server over your test history | [A] | `testfile-ts/mcp` + `eve`: asking an AI "which tests got flaky this week?" — read-only tools over recorded runs. Timely, high shareability. |
| 6.5 | Shipping a CLI five ways: esbuild, Rslib, Deno, Bun, and Node SEA | [A] | The `*-bundle` experiments, sizes and trade-offs; the 419 KB `testfile-report` binary with no JS engine (scriptc). Pure engineering-blog catnip. |

---

## The "help us test Testfile" thread

Goal 2 deserves recurring formats, not just one post:

- **6.2 "The road to version 1"** is the anchor — publish it in the first
  batch and link it from every post's footer.
- **"Field report" mini-series**: take a well-known open-source repo,
  run `testfile init` + `testfile run` on it live, publish what worked and
  what didn't — including Testfile's own failures. Honest posts recruit
  better testers than polished ones. (One per month, ~1 page each.)
- **`testfile doctor` (1.4)** framed as "run this, paste the output in an
  issue" — the lowest-friction feedback loop we have.
- A standing **changelog/release-notes post** per release, closing the loop:
  "you reported X in a field report, v0.x fixes it".

## Publishing roadmap

Assumes roughly two posts per month, sequenced so every launch-window
reader finds an easy on-ramp, while depth accumulates for return visits.
Sequence matters more than the calendar — shift dates, keep the order.

**Phase 1 — Launch (first 6 weeks): all on-ramp.**
1.1 Introducing Testfile → 1.2 Zero to green → 6.2 The road to version 1
→ 2.1 pytest + Postgres → 2.2 Playwright.

**Phase 2 — CI credibility (next 2 months): prove portability.**
3.1 GitHub Action → 1.3 `init` imports → 3.2 every CI → 2.4 matrix recipe
→ first field report.

**Phase 3 — Differentiation (next 2 months): runs-as-data.**
4.1 `run.yaml` → 4.2 viewers → 4.3 run diffs → 3.3 three platforms
→ 2.5 monorepo → field report #2.

**Phase 4 — Depth (ongoing, alternate one [I/A] post with one [E] recipe):**
4.4 flaky verdicts → 5.1 matrix deep dive → 4.5 sync → 5.3 caching
→ 3.4 sharding → 6.4 MCP → 6.5 five bundles → 5.6 Kubernetes, with new
recipes (2.6–2.8) interleaved. Post 6.1 (spec & conformance) whenever a
second runner implementation shows interest.

**Timed to the v1 review cycle (Q4 2026):** a "last call for v0 feedback"
post ~6 weeks before the review closes, and a "what changed in version 1"
post at release — both follow-ups to 6.2.

## Notes for implementation (separate task)

- Add a `blog/` content collection and `website/src/pages/blog/[...slug].astro`
  mirroring the docs pipeline; an RSS feed matters for this audience.
- Frontmatter: `title`, `date`, `description`, `level` (easy/intermediate/
  advanced), `series`, optional `example:` linking to `examples/<dir>`.
- Every code block in recipe posts should come from a CI-validated
  `examples/` folder (the docs already validate snippets this way).
- Include blog posts in `llms.txt` / `llms-full.txt` generation alongside
  the docs.
