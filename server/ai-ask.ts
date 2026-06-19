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
import { SCHEMA_SUMMARY } from "./ai-ask-schema";

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const anthropic = ANTHROPIC_API_KEY?.startsWith("sk-ant-")
  ? new Anthropic({ apiKey: ANTHROPIC_API_KEY })
  : null;


const SYSTEM_PROMPT = `You are the analytics assistant for the CNCxSOHO Import Tracker (a customs / import-tracking app for a company that imports goods into Turkey). Users ask questions about import procedures, taxes, expenses, payments, products, and Turkish HS codes.

The interface language is English. Always respond in the SAME LANGUAGE as the user's question (English by default; mirror Turkish if they wrote in Turkish, etc.).

Today's date is provided in the first user turn — use it to resolve relative phrases like "January", "last month", "this year", "the last 3 months" (or their Turkish equivalents) into absolute YYYY-MM-DD ranges before calling tools.

How to work:
1. Decide which tool(s) you need. You may call multiple in sequence — and you SHOULD call as many as needed: a typical "list with totals" question takes 1–3 tool calls (fetch totals, fetch list, then present_answer). Don't bail out early.
2. Once you have enough data, call \`present_answer\` with:
   - an answer in markdown, length calibrated to the question (terse for a simple metric, fuller for analysis/comparison/"why" questions), in the user's language
   - table block(s) whenever the user asks for a list / breakdown / details / "ver liste olarak" / "tarih ve fatura bilgileri" / etc.
   - chart block(s) (type: bar or line) when the user asks about trends, by-month/year, or rankings
3. If a question is ambiguous, ask one clarifying question via \`present_answer\` (text only) instead of guessing.

NEVER claim "the system doesn't support listing details" or similar. If the user asks for a detailed list, set \`list_limit\` (e.g. 100) on the relevant tool and return the rows in a table. The tools query_procedures, query_taxes, query_expenses, and query_payments all support \`list_limit\`.

ZERO-RESULT HANDLING — CRITICAL:
- If a tool call returns 0 rows / count=0 with the user's filters, DO NOT silently retry the same tool with fewer filters and pretend the looser results match. That misleads the user.
- Instead, EITHER: (a) call \`present_answer\` saying "0 records matched <vendor>/<filters>" and offer to broaden, OR (b) make ONE diagnostic call with \`group_by:'issuer'\` (no issuer filter) so you can show what issuer values DO exist and ask the user which one they meant.
- It is BETTER to return "0 results — here are the issuers we have" than to return a wide list under a vendor label that doesn't actually match.
- The \`issuer_contains\` filter on query_expenses matches the issuer column ONLY (not notes). If 0 rows come back, that means the issuer field literally doesn't contain that string — call group_by:"issuer" without a filter to discover the actual vendor names recorded in the issuer column, then either retry with the correct vendor name or tell the user "the issuer column for these records is empty/different — please check data entry".

AUDITABILITY — when filtering by issuer:
- Whenever you used \`issuer_contains\` (or are filtering by vendor in any other way) and you display a list of matched rows, the table you put in present_answer.blocks MUST include the **Issuer** column for each row, BEFORE the Notes column. The user must be able to see exactly which value in the issuer field caused the row to match — this is non-negotiable. Don't hide it just because notes are more descriptive.
- Recommended column order for issuer-filtered expense lists: Tarih (Date), Fatura No (Invoice No), Issuer, Tutar (Amount), Para Birimi (Currency), Prosedür (Procedure), Notlar (Notes). Adapt header language to the user's question language.

Currency awareness — CRITICAL:
- importExpenses rows have a \`currency\` column (TL, USD, EUR …). Amounts in different currencies CANNOT be summed.
- query_expenses always returns \`totals_by_currency\` alongside the headline total. ALWAYS check this array.
  - If only ONE currency is present, report the headline total with that currency symbol.
  - If MULTIPLE currencies are present, EITHER (a) re-call query_expenses with a specific \`currency\` filter and report each separately, OR (b) report the per-currency breakdown directly. Never report a single mixed total as if it were one currency.
- For Turkish-domestic vendors (THY, customs, transportation, storage), default the currency to TL ("TL") unless the data shows otherwise.
- payments table has no currency column — currency lives on the parent procedure. Mention this caveat if you sum payment amounts.

Formatting rules:
- Use thousands separators in numbers appropriate to the user's language (1,234,567 for English; 1.234.567 for Turkish).
- Currency: keep the source currency (USD, TL/₺, EUR). Don't convert.
- Date ranges: when filtering, prefer arrival_date for procedures (that's when goods arrive). For importExpenses, the date column is invoice_date. Use invoice_date for procedures only if the user explicitly says "invoice date" / "fatura tarihi".
- Always include the SHIPPER's full name when listing procedures.
- Never invent numbers — if a tool returns 0/empty, say so plainly.

Available tools — query_procedures, query_taxes, query_expenses, query_payments, query_products, query_hs_codes, query_time_series, present_answer (REQUIRED final call).

When the fixed query_* tools can't express the question (rankings like "most expensive", comparisons between shippers, derived metrics like averages/ratios/margins, or multi-table joins), use the \`run_sql\` tool to write a single read-only SELECT. Always add a LIMIT (<=200). Use the schema below for exact table/column names.

${SCHEMA_SUMMARY}

DEPTH: Calibrate answer length to the question. For a simple metric, stay terse. When the user asks "why", for analysis, comparison, or interpretation, give a fuller answer with the reasoning and relevant context — don't truncate to one line.

OUT-OF-DATABASE QUESTIONS: For questions the database can't answer (Turkish customs regulation, how a tax is calculated, general advice), answer from your own knowledge — but set present_answer.source to 'general_knowledge' (or 'mixed' if you also used DB data) AND add a short caveat in the answer text that this part is general knowledge and should be verified. Never present general knowledge as if it came from the database. Set source to 'database' when every fact came from query results.`;

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
  source?: "database" | "general_knowledge" | "mixed";
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

const ROUTER_MODEL = "claude-haiku-4-5";
const SIMPLE_MODEL = "claude-sonnet-4-6";
const COMPLEX_MODEL = "claude-opus-4-8";

/**
 * Fast pre-classification of question difficulty so we can pick a model.
 * Returns "simple" on any error/ambiguity (safe default — keeps latency low).
 */
async function classifyDifficulty(question: string): Promise<"simple" | "complex"> {
  if (!anthropic) return "simple";
  try {
    const res: any = await anthropic.messages.create({
      model: ROUTER_MODEL,
      max_tokens: 8,
      system:
        "Classify the user's analytics question by difficulty. Reply with EXACTLY one word: " +
        "'simple' (a single metric, count, total, or list with basic filters) or " +
        "'complex' (comparisons, rankings, derived metrics like averages/ratios, multi-table " +
        "joins, or open-ended/general-knowledge questions). Reply with only the word.",
      messages: [{ role: "user", content: question }],
    });
    const text = (res.content ?? [])
      .filter((b: any) => b.type === "text")
      .map((b: any) => b.text)
      .join(" ")
      .toLowerCase();
    return text.includes("complex") ? "complex" : "simple";
  } catch {
    return "simple";
  }
}

export async function handleAskRequest(req: AskRequest): Promise<AskResponse> {
  if (!anthropic) {
    throw new Error("ANTHROPIC_API_KEY not configured");
  }

  const today = req.todayISO ?? new Date().toISOString().slice(0, 10);

  const difficulty = await classifyDifficulty(req.question);
  const model = difficulty === "complex" ? COMPLEX_MODEL : SIMPLE_MODEL;

  const messages: Anthropic.MessageParam[] = [
    {
      role: "user",
      content: `Today is ${today}.\n\nQuestion: ${req.question}`,
    },
  ];

  const trace: { name: string; input: any }[] = [];
  // Opus (complex) turns are far slower; cap them tighter to respect the ~60s proxy timeout.
  const MAX_TURNS = model === COMPLEX_MODEL ? 8 : 12;
  const DEADLINE_MS = 50_000; // bail out before the ~60s proxy timeout, return a graceful message not a 504
  const startedAt = Date.now();

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    if (Date.now() - startedAt > DEADLINE_MS) break;
    const response: any = await anthropic.messages.create({
      model,
      max_tokens: 16000,
      thinking: { type: "adaptive" },
      system: SYSTEM_PROMPT,
      tools: TOOL_SCHEMAS as any,
      messages,
    } as any);

    // Look for tool_use blocks
    const toolUses = response.content.filter((b: any) => b.type === "tool_use") as any[];
    const presentAnswerCall = toolUses.find(t => t.name === "present_answer");

    if (presentAnswerCall) {
      trace.push({ name: presentAnswerCall.name, input: presentAnswerCall.input });
      const args = presentAnswerCall.input as any;
      return {
        answer: typeof args?.answer === "string" ? args.answer : "(no answer)",
        blocks: Array.isArray(args?.blocks) ? args.blocks : undefined,
        source: args?.source,
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
    answer: "Sorry — I couldn't gather enough information to answer that. Please try rephrasing more specifically.",
    tool_calls: trace,
  };
}
