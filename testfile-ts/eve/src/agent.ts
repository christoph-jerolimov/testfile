// One question, answered against the recorded runs.
//
// The loop is the SDK's tool runner: it asks the model, runs whichever
// history tools the model reaches for, feeds the results back, and stops
// when there is nothing left to look up. Writing that loop here would only
// be a worse copy of it.
import Anthropic from "@anthropic-ai/sdk";
import type { RunHistory } from "@testfile/core";
import { historyTools } from "./tools.js";

// Claude Opus 5, with adaptive thinking: reading a failed run is exactly the
// kind of question where the model should decide how much to think, and the
// answer is worth more than the tokens.
export const MODEL = "claude-opus-5";

export const SYSTEM = [
  "You answer questions about recorded Testfile runs, using the tools provided.",
  "",
  "Look before you answer: the tools are the only thing that knows what actually ran.",
  "When a run is red, explain_run names the failing tests, the end of each log, and",
  "whether the history already calls a test flaky; repro_test gives the command that",
  "reruns exactly one of them. Prefer citing a run id, a test path and a log line over",
  "describing them.",
  "",
  "Everything you can reach is read-only. You cannot run tests, and should not claim to",
  "have; when running one is the answer, say which command the user should run.",
].join("\n");

export interface AskOptions {
  history: RunHistory;
  question: string;
  client?: Anthropic;
  model?: string;
  maxTokens?: number;
  // Called with each tool the model reaches for, so a CLI can show its work.
  onToolUse?: (name: string) => void;
}

// The answer text. Tool calls happen inside; only the final message comes back.
export async function ask(options: AskOptions): Promise<string> {
  const client = options.client ?? new Anthropic();
  const tools = historyTools(options.history);
  const runner = client.beta.messages.toolRunner({
    model: options.model ?? MODEL,
    // Streaming, so a long answer cannot hit the SDK's HTTP timeout.
    stream: true,
    max_tokens: options.maxTokens ?? 16000,
    thinking: { type: "adaptive" },
    system: SYSTEM,
    tools,
    messages: [{ role: "user", content: options.question }],
  });

  let final;
  for await (const stream of runner) {
    final = await stream.finalMessage();
    if (options.onToolUse) {
      for (const block of final.content) {
        if (block.type === "tool_use") options.onToolUse(block.name);
      }
    }
  }

  if (!final) return "";
  // A refusal arrives as a successful response with no answer in it; saying
  // so beats printing an empty line.
  if (final.stop_reason === "refusal") {
    return "The model declined to answer this one.";
  }
  return final.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("")
    .trim();
}
