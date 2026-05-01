// server/ai-ask.ts
// "Ask CNC?" — natural-language Q&A backed by Claude tool-use against the
// project database. The route handler calls handleAskRequest which:
//   1. Sends the user's question + system prompt + tool schemas to Claude.
//   2. Loops: when Claude returns tool_use blocks, run the tool(s), append
//      tool_result content, and call Claude again.
//   3. Stops when Claude calls the final present_answer tool — its arguments
//      are the structured response we send back to the frontend.

import Anthropic from "@anthropic-ai/sdk";
import { TOOL_SCHEMAS, runTool } from "./ai-ask-tools";

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const anthropic = ANTHROPIC_API_KEY?.startsWith("sk-ant-")
  ? new Anthropic({ apiKey: ANTHROPIC_API_KEY })
  : null;

const ASK_MODEL = "claude-sonnet-4-20250514"; // Tool-use accuracy matters here.

const SYSTEM_PROMPT = `You are the analytics assistant for the CNCxSOHO Import Tracker (a Turkish customs / import-tracking app). Users ask questions in Turkish or English about import procedures, taxes, expenses, payments, products, and Turkish HS codes.

Today's date is provided in the first user turn — use it to resolve relative phrases like "Ocak ayı", "geçen ay", "bu yıl", "son 3 ay" into absolute YYYY-MM-DD ranges before calling tools.

How to work:
1. Decide which tool(s) you need. You may call multiple in sequence.
2. Once you have enough data, call \`present_answer\` with:
   - a concise Turkish answer in markdown (1–3 short paragraphs)
   - optional table block(s) for lists / comparisons
   - optional chart block(s) (type: bar or line) when the user asks about trends, by-month/year, or rankings
3. If a question is ambiguous, ask one clarifying question via \`present_answer\` (text only) instead of guessing.

Formatting rules:
- Use thousands separators in numbers (e.g., 1.234.567).
- Currency: keep the source currency (USD, TL/₺, EUR). Don't convert.
- Date ranges: when filtering, prefer arrival_date for procedures (that's when goods arrive). Use invoice_date only if the user explicitly says "fatura tarihi".
- Always include the SHIPPER's full name when listing procedures.
- Never invent numbers — if a tool returns 0/empty, say so plainly.

Available tools — query_procedures, query_taxes, query_expenses, query_payments, query_products, query_hs_codes, query_time_series, present_answer (REQUIRED final call).`;

export interface AskBlock {
  type: "table" | "chart";
  title?: string;
  // table fields
  headers?: string[];
  rows?: any[][];
  // chart fields
  chart_type?: "bar" | "line";
  x_label?: string;
  y_label?: string;
  data?: { name: string; value: number }[];
}

export interface AskResponse {
  answer: string;
  blocks?: AskBlock[];
  tool_calls?: { name: string; input: any }[]; // for transparency / debugging
}

export interface AskRequest {
  question: string;
  /** ISO date string for "today". Defaults to server's now. */
  todayISO?: string;
}

export function isAskConfigured(): boolean {
  return !!anthropic;
}

export async function handleAskRequest(req: AskRequest): Promise<AskResponse> {
  if (!anthropic) {
    throw new Error("ANTHROPIC_API_KEY not configured");
  }

  const today = req.todayISO ?? new Date().toISOString().slice(0, 10);

  const messages: Anthropic.MessageParam[] = [
    {
      role: "user",
      content: `Today is ${today}.\n\nQuestion: ${req.question}`,
    },
  ];

  const trace: { name: string; input: any }[] = [];
  const MAX_TURNS = 6;

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const response = await anthropic.messages.create({
      model: ASK_MODEL,
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      tools: TOOL_SCHEMAS as any,
      messages,
    });

    // Look for tool_use blocks
    const toolUses = response.content.filter((b: any) => b.type === "tool_use") as any[];
    const presentAnswerCall = toolUses.find(t => t.name === "present_answer");

    if (presentAnswerCall) {
      trace.push({ name: presentAnswerCall.name, input: presentAnswerCall.input });
      const args = presentAnswerCall.input as any;
      return {
        answer: typeof args?.answer === "string" ? args.answer : "(no answer)",
        blocks: Array.isArray(args?.blocks) ? args.blocks : undefined,
        tool_calls: trace,
      };
    }

    if (toolUses.length === 0) {
      // Claude responded with text only (no tool call). Convert text to answer.
      const textBlock = response.content.find((b: any) => b.type === "text") as any;
      return {
        answer: textBlock?.text ?? "(empty response)",
        tool_calls: trace,
      };
    }

    // Append the assistant turn (containing tool_use) to messages
    messages.push({ role: "assistant", content: response.content as any });

    // Run each tool and append results in one user turn
    const toolResults: any[] = [];
    for (const t of toolUses) {
      trace.push({ name: t.name, input: t.input });
      try {
        const result = await runTool(t.name, t.input);
        toolResults.push({
          type: "tool_result",
          tool_use_id: t.id,
          content: JSON.stringify(result),
        });
      } catch (err: any) {
        toolResults.push({
          type: "tool_result",
          tool_use_id: t.id,
          content: `Error running ${t.name}: ${err?.message ?? String(err)}`,
          is_error: true,
        });
      }
    }
    messages.push({ role: "user", content: toolResults as any });

    if (response.stop_reason === "end_turn") {
      // Defensive: shouldn't happen with tool calls, but handle gracefully.
      break;
    }
  }

  // Loop exhausted
  return {
    answer: "Üzgünüm, bu soruyu cevaplamak için yeterli bilgiyi toplayamadım. Lütfen daha spesifik sor.",
    tool_calls: trace,
  };
}
