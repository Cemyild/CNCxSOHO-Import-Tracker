// server/mcp/errors.ts
// Standardized error helpers for MCP tools. McpToolError is converted to a tool
// response with isError=true; other thrown errors become 500-equivalent errors.

export class McpToolError extends Error {
  constructor(message: string, public readonly publicSummary?: string) {
    super(message);
    this.name = "McpToolError";
  }
}

export function asToolErrorResponse(message: string): {
  content: { type: "text"; text: string }[];
  isError: true;
} {
  return { content: [{ type: "text", text: message }], isError: true };
}
