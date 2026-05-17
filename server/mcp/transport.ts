// server/mcp/transport.ts
// Bridges Express POST/GET/DELETE /mcp to the MCP Streamable HTTP transport.
// Stateless mode (sessionIdGenerator: undefined) — single-user agent, no
// long-lived sessions required.
import { Server as McpServer } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { wireRegistryToServer } from "./registry";
import type { Request, Response } from "express";

function buildServer(): McpServer {
  return new McpServer(
    { name: "cncxsoho-mcp", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );
}

export async function handleMcpRequest(req: Request, res: Response): Promise<void> {
  // Fresh server + transport per request — simplest correct stateless impl.
  const server = buildServer();
  wireRegistryToServer(server, () => ({
    agentId: req.mcpAuth!.agentId,
    tokenFingerprint: req.mcpAuth!.tokenFingerprint,
  }));
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on("close", () => {
    transport.close().catch(() => {});
    server.close().catch(() => {});
  });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
}
