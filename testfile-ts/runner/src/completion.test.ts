import assert from "node:assert/strict";
import { test } from "node:test";
import { generateCompletion, type CompletionModel } from "./completion.js";

const model: CompletionModel = {
  program: "testfile",
  commands: [
    {
      name: "start",
      description: "Start the test suite",
      flags: ["-f", "--filter", "--fail-fast"],
    },
    { name: "history", description: "List or show recorded runs", flags: ["--run", "--diff"] },
  ],
};

test("bash completion lists commands and per-command flags", () => {
  const script = generateCompletion(model, "bash");
  assert.match(script, /compgen -W "start history"/);
  assert.match(script, /start\) opts="-f --filter --fail-fast"/);
  assert.match(script, /complete -F _testfile_completions testfile/);
});

test("zsh completion describes commands and their arguments", () => {
  const script = generateCompletion(model, "zsh");
  assert.match(script, /#compdef testfile/);
  assert.match(script, /'start:Start the test suite'/);
  assert.match(script, /'--fail-fast'/);
});

test("fish completion emits subcommand and flag rules", () => {
  const script = generateCompletion(model, "fish");
  assert.match(script, /-n __fish_use_subcommand -a start -d 'Start the test suite'/);
  assert.match(script, /__fish_seen_subcommand_from start" -l fail-fast/);
  assert.match(script, /__fish_seen_subcommand_from start" -s f/);
  assert.match(script, /__fish_seen_subcommand_from history" -l diff/);
});

test("unknown shells are rejected", () => {
  assert.throws(() => generateCompletion(model, "powershell"), /expected bash, zsh or fish/);
});
