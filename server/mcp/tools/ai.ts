// server/mcp/tools/ai.ts
// Wraps the in-app "Ask CNC?" handler (server/ai-ask.ts#handleAskRequest) so
// Cowork can defer narrow analytics questions to the same structured-answer
// pipeline that backs the React UI. The response shape is identical:
// { answer, blocks?, tool_calls? }.
//
// No session dependency — handleAskRequest is safe to call from MCP.
// Requires ANTHROPIC_API_KEY in env (it throws "ANTHROPIC_API_KEY not
// configured" otherwise).
import { registerTool } from "../registry";
import { handleAskRequest } from "../../ai-ask";

registerTool({
  name: "ai_ask_internal",
  tier: "ai",
  description:
    "Run an analytics question through the in-app 'Ask CNC?' pipeline. Returns the same {answer, blocks, tool_calls} structure used by the React UI. Useful when Cowork wants a structured analytics answer rather than building one from raw read tool calls.",
  inputSchema: {
    type: "object",
    properties: {
      question: {
        type: "string",
        description: "The natural-language analytics question to ask.",
      },
      today: {
        type: "string",
        description:
          "Optional override for 'today' as YYYY-MM-DD. Used to resolve relative phrases (\"last month\", \"this year\"). Defaults to the server's current date.",
      },
    },
    required: ["question"],
    additionalProperties: false,
  },
  handler: async (args: any) => {
    const out = await handleAskRequest({
      question: args.question,
      todayISO: args.today,
    });
    const sliced = String(args.question ?? "").slice(0, 80);
    return {
      data: out,
      meta: { summary: `Ask: ${sliced}` },
    };
  },
});
