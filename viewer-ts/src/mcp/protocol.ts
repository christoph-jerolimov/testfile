// The wire half of the MCP server: JSON-RPC 2.0 over MCP's stdio transport,
// which frames messages as newline-delimited JSON.
//
// The official SDK would do this too, but it arrives with express, hono,
// jose and two hundred transitive packages - a poor trade for a read-only
// CLI whose whole dependency list is five entries. A tools-only server
// needs five methods, and having them here means they are tested like
// everything else rather than trusted.
export interface JsonRpcRequest {
  jsonrpc: "2.0";
  // Absent for notifications, which are never answered.
  id?: string | number;
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: string | number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

// The errors JSON-RPC defines; a tool that fails is NOT one of these -
// see toolError() below.
export const PARSE_ERROR = -32700;
export const INVALID_REQUEST = -32600;
export const METHOD_NOT_FOUND = -32601;
export const INVALID_PARAMS = -32602;
export const INTERNAL_ERROR = -32603;

// The revision of the protocol this server speaks. A client asking for
// another one still gets this: the negotiation is "here is what I speak",
// and a client that cannot live with it disconnects.
export const PROTOCOL_VERSION = "2025-06-18";

export interface ToolDefinition {
  name: string;
  description: string;
  // JSON Schema of the arguments, as MCP requires it.
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
  // Hints a client may use: every tool here only reads.
  annotations?: { readOnlyHint?: boolean; idempotentHint?: boolean };
  run: (args: Record<string, unknown>) => unknown;
}

export interface ServerInfo {
  name: string;
  version: string;
  // Shown to a model before it picks a tool; a good one saves a bad call.
  instructions?: string;
}

// A tool's answer. Structured data goes out as JSON text: every client can
// read text, and a model reads JSON as well as it reads prose.
function toolResult(value: unknown): unknown {
  const text = typeof value === "string" ? value : `${JSON.stringify(value, null, 2)}`;
  return { content: [{ type: "text", text }] };
}

// A tool that could not do its job is a *result*, not a protocol error:
// the model should see what went wrong and pick differently, rather than
// the connection treating it as a fault.
function toolError(message: string): unknown {
  return { content: [{ type: "text", text: message }], isError: true };
}

// Answers one request. Returns undefined for notifications, which by
// definition get no reply.
export function handle(
  request: JsonRpcRequest,
  server: ServerInfo,
  tools: readonly ToolDefinition[],
): JsonRpcResponse | undefined {
  const { id, method } = request;
  const reply = (result: unknown): JsonRpcResponse | undefined =>
    id === undefined ? undefined : { jsonrpc: "2.0", id, result };
  const fail = (code: number, message: string): JsonRpcResponse | undefined =>
    id === undefined ? undefined : { jsonrpc: "2.0", id, error: { code, message } };

  switch (method) {
    case "initialize":
      return reply({
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: server.name, version: server.version },
        ...(server.instructions ? { instructions: server.instructions } : {}),
      });
    // The client telling us it is ready; nothing to answer.
    case "notifications/initialized":
      return undefined;
    case "ping":
      return reply({});
    case "tools/list":
      return reply({
        tools: tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
          ...(tool.annotations ? { annotations: tool.annotations } : {}),
        })),
      });
    case "tools/call": {
      const name = request.params?.name;
      if (typeof name !== "string") return fail(INVALID_PARAMS, "tools/call needs a tool name");
      const tool = tools.find((candidate) => candidate.name === name);
      if (!tool) return fail(INVALID_PARAMS, `no such tool: ${name}`);
      const args = (request.params?.arguments ?? {}) as Record<string, unknown>;
      try {
        return reply(toolResult(tool.run(args)));
      } catch (err) {
        return reply(toolError(err instanceof Error ? err.message : String(err)));
      }
    }
    default:
      return fail(METHOD_NOT_FOUND, `unknown method: ${method}`);
  }
}

// Parses one line and answers it. A line that is not a request at all
// still gets an answer where JSON-RPC allows one, so a confused client
// learns why instead of waiting.
export function handleLine(
  line: string,
  server: ServerInfo,
  tools: readonly ToolDefinition[],
): JsonRpcResponse | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return { jsonrpc: "2.0", id: 0, error: { code: PARSE_ERROR, message: "invalid JSON" } };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { jsonrpc: "2.0", id: 0, error: { code: INVALID_REQUEST, message: "not a request" } };
  }
  const request = parsed as JsonRpcRequest;
  if (typeof request.method !== "string") {
    const id = request.id;
    return {
      jsonrpc: "2.0",
      id: id ?? 0,
      error: { code: INVALID_REQUEST, message: "no method" },
    };
  }
  return handle(request, server, tools);
}

// Reads newline-delimited requests and writes newline-delimited responses.
// Blank lines are skipped: some clients keep the pipe warm with them.
export function serveStdio(
  input: NodeJS.ReadableStream,
  output: NodeJS.WritableStream,
  server: ServerInfo,
  tools: readonly ToolDefinition[],
): void {
  let buffer = "";
  input.setEncoding("utf8");
  input.on("data", (chunk: string) => {
    buffer += chunk;
    let at = buffer.indexOf("\n");
    while (at >= 0) {
      const line = buffer.slice(0, at).trim();
      buffer = buffer.slice(at + 1);
      if (line !== "") {
        const response = handleLine(line, server, tools);
        if (response) output.write(`${JSON.stringify(response)}\n`);
      }
      at = buffer.indexOf("\n");
    }
  });
}
