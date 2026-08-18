// The MCP tools, handed to the model.
//
// `testfile mcp` serves those tools over stdio to an editor. eve wants the
// same tools in the same process, so there is no server and no transport
// here - just the one method the adapter needs.
//
// The conversion itself is the SDK's (`mcpTools`), not ours: @testfile.dev/mcp's
// ToolDefinition already has the shape it expects - a name, a description,
// and an `inputSchema` that is a JSON Schema object - so nothing has to
// restate eight schemas in a second dialect where they could drift.
import { mcpTools } from "@anthropic-ai/sdk/helpers/beta/mcp";
import type { BetaRunnableTool } from "@anthropic-ai/sdk/lib/tools/BetaRunnableTool";
import type { RunHistory } from "@testfile.dev/core";
import { testfileTools, type ToolDefinition } from "@testfile.dev/mcp";

// What the SDK adapter calls. `@modelcontextprotocol/sdk`'s Client is one
// implementation; this is the other, and the only one eve needs.
export interface McpClientLike {
  callTool(params: {
    name: string;
    arguments?: Record<string, unknown>;
  }): Promise<{ content: { type: "text"; text: string }[]; isError?: boolean }>;
}

// Calls a tool the way the stdio server would answer it: the same JSON, and
// a failure reported as a result the model can read rather than an exception
// that ends the turn. protocol.ts does this for the wire; this does it for
// the function call, and the two must keep saying the same thing.
export function inProcessClient(tools: readonly ToolDefinition[]): McpClientLike {
  const byName = new Map(tools.map((tool) => [tool.name, tool]));
  return {
    async callTool({ name, arguments: args }) {
      const tool = byName.get(name);
      if (!tool) {
        return { content: [{ type: "text", text: `no tool named "${name}"` }], isError: true };
      }
      try {
        const value = tool.run(args ?? {});
        const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
        return { content: [{ type: "text", text }] };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text", text: message }], isError: true };
      }
    },
  };
}

// Every tool the MCP server exposes, ready for the tool runner.
export function historyTools(history: RunHistory): BetaRunnableTool<Record<string, unknown>>[] {
  const definitions = testfileTools(() => history);
  return mcpTools(definitions, inProcessClient(definitions));
}
