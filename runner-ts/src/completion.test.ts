import assert from "node:assert/strict";
import { test } from "node:test";
import { generateCompletion, type CompletionModel } from "./completion.js";

const model: CompletionModel = {
  program: "testfile",
  commands: [
    { name: "run", description: "Run the test suite", flags: ["-f", "--filter", "--fail-fast"] },
    { name: "history", description: "List or show recorded runs", flags: ["--run", "--diff"] },
  ],
};

test("bash completion lists commands and per-command flags", () => {
  const script = generateCompletion(model, "bash");
  assert.match(script, /compgen -W "run history"/);
  assert.match(script, /run\) opts="-f --filter --fail-fast"/);
  assert.match(script, /complete -F _testfile_completions testfile/);
});

test("zsh completion describes commands and their arguments", () => {
  const script = generateCompletion(model, "zsh");
  assert.match(script, /#compdef testfile/);
  assert.match(script, /'run:Run the test suite'/);
  assert.match(script, /'--fail-fast'/);
});

test("fish completion emits subcommand and flag rules", () => {
  const script = generateCompletion(model, "fish");
  assert.match(script, /-n __fish_use_subcommand -a run -d 'Run the test suite'/);
  assert.match(script, /__fish_seen_subcommand_from run" -l fail-fast/);
  assert.match(script, /__fish_seen_subcommand_from run" -s f/);
  assert.match(script, /__fish_seen_subcommand_from history" -l diff/);
});

test("unknown shells are rejected", () => {
  assert.throws(() => generateCompletion(model, "powershell"), /expected bash, zsh or fish/);
});
