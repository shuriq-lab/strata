import { Navigator } from "./navigator";

export const MCP_PROTOCOL = "2024-11-05";

export const TOOLS = [
  {
    name: "read_files",
    description:
      "Read high-level pyramid files: profile.md, tracks/*.md, or contract.json. Refuses raw and record files.",
    inputSchema: {
      type: "object",
      properties: {
        paths: {
          type: "array",
          items: { type: "string" },
          description: "Repository-relative paths.",
        },
      },
      required: ["paths"],
    },
  },
  {
    name: "get_records",
    description: "Fetch typed memory records by id.",
    inputSchema: {
      type: "object",
      properties: {
        ids: { type: "array", items: { type: "string" } },
      },
      required: ["ids"],
    },
  },
  {
    name: "search_records",
    description: "Keyword search over typed memory records. Returns at most five unless limit is set.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        type: {
          type: "string",
          enum: ["claim", "source", "evidence", "instruction", "preference", "event"],
        },
        limit: { type: "number" },
      },
      required: ["query"],
    },
  },
  {
    name: "get_conversations",
    description: "Fetch raw call messages by id.",
    inputSchema: {
      type: "object",
      properties: {
        ids: { type: "array", items: { type: "string" } },
      },
      required: ["ids"],
    },
  },
  {
    name: "search_conversations",
    description: "Keyword search over raw call messages. Returns at most five unless limit is set.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        limit: { type: "number" },
      },
      required: ["query"],
    },
  },
] as const;

interface RpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: unknown;
}

export function handleMcp(message: RpcRequest, navigator: Navigator): unknown | null {
  const id = message.id ?? null;
  if (message.method === "notifications/initialized" || message.method === "notifications/cancelled") {
    return null;
  }
  if (message.method === "initialize") {
    return ok(id, {
      protocolVersion: MCP_PROTOCOL,
      capabilities: { tools: {} },
      serverInfo: { name: "strata-navigator", version: "0.1.0" },
    });
  }
  if (message.method === "tools/list") {
    return ok(id, { tools: TOOLS });
  }
  if (message.method === "ping") return ok(id, {});
  if (message.method === "tools/call") {
    const params = (message.params ?? {}) as { name?: string; arguments?: Record<string, unknown> };
    const name = params.name;
    const args = params.arguments ?? {};
    try {
      const result = callTool(navigator, name, args);
      return ok(id, {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        isError: false,
      });
    } catch (error) {
      return ok(id, {
        content: [{ type: "text", text: error instanceof Error ? error.message : "tool failed" }],
        isError: true,
      });
    }
  }
  return {
    jsonrpc: "2.0",
    id,
    error: { code: -32601, message: `Method not found: ${message.method ?? ""}` },
  };
}

function callTool(navigator: Navigator, name: string | undefined, args: Record<string, unknown>) {
  switch (name) {
    case "read_files":
      return navigator.readFiles(args as { paths?: string[]; path?: string });
    case "get_records":
      return navigator.getRecords(args as { ids?: string[] });
    case "search_records":
      return navigator.searchRecords(args as { query?: string; type?: string; limit?: number });
    case "get_conversations":
      return navigator.getConversations(args as { ids?: string[] });
    case "search_conversations":
      return navigator.searchConversations(args as { query?: string; limit?: number });
    default:
      throw new Error(`Unknown tool: ${name ?? ""}`);
  }
}

function ok(id: string | number | null, result: unknown) {
  return { jsonrpc: "2.0", id, result };
}
