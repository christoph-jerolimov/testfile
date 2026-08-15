# @testfile/eve

Ask about the runs you already recorded, from a terminal.

```sh
$ eve "why did the last run fail?"
  … list_runs
  … explain_run
  … get_test_log
The last run (20260815-094023-c856) failed on ci/checks/viewer-e2e. …
```

`testfile mcp` serves the recorded runs to an editor over the Model Context
Protocol. eve is the same tools with a different front door: for when the
question is one sentence long and opening an assistant to ask it is the slow
way round.

## What it is made of

Almost nothing, deliberately — the three pieces already existed:

| | |
| --- | --- |
| The tools | [`@testfile/mcp`](../mcp/)'s, unchanged — `list_runs`, `get_run`, `explain_run`, `repro_test`, `get_test_log`, `diff_runs`, `list_tests`, `list_flaky` |
| The conversion | the Anthropic SDK's `mcpTools()` — `ToolDefinition` already has the shape it expects, so no schema is restated in a second dialect where it could drift |
| The loop | the SDK's tool runner — asking, running the tools the model reaches for, feeding results back |

What is left is [`tools.ts`](src/tools.ts): the tools run in this process, so
there is no server and no transport, just the one method the SDK's adapter
calls. That adapter is the only thing here that could be wrong on its own, so
it is [tested against the stdio server](src/eve.test.ts) — same call, byte-identical
answer — rather than against a copy of its own expectations.

Everything reads. eve cannot run tests, and is told to say which command to
run instead of pretending it did.

## Running it

```sh
export ANTHROPIC_API_KEY=sk-ant-...     # or `ant auth login`
eve "which tests are flaky?"
eve -C ../other-project "compare the last two runs"
eve -q "is ci/checks/e2e still failing?" > answer.txt
```

`-C` points at a directory containing a `.testfile` folder; `-q` prints only
the answer, leaving out the running list of tools on stderr.

It runs on **Claude Opus 5** with adaptive thinking: reading a failed run is
exactly the kind of question where the model should decide how much to think.
