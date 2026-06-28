import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Sparkles,
  Send,
  Loader2,
  Bot,
  User as UserIcon,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { PageLayout } from "@/components/layout/PageLayout";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

interface Block {
  type: "table" | "chart";
  title?: string;
  // table
  headers?: string[];
  rows?: any[][];
  // chart
  chart_type?: "bar" | "line";
  x_label?: string;
  y_label?: string;
  data?: { name: string; value: number }[];
}

interface ToolCall {
  name: string;
  input: any;
}

interface Message {
  role: "user" | "assistant";
  text: string;
  blocks?: Block[];
  toolCalls?: ToolCall[];
  pending?: boolean;
}

function fmtNum(v: any): string {
  if (v == null) return "—";
  if (typeof v === "number") return v.toLocaleString("tr-TR", { maximumFractionDigits: 2 });
  return String(v);
}

function ChartBlock({ block }: { block: Block }) {
  if (!block.data || block.data.length === 0) return null;
  const ChartCmp = block.chart_type === "line" ? LineChart : BarChart;
  const SeriesCmp: any = block.chart_type === "line" ? Line : Bar;

  return (
    <div className="rounded-md border bg-card p-3 mt-3">
      {block.title && <div className="text-sm font-medium mb-2">{block.title}</div>}
      <div className="h-[280px] w-full">
        <ResponsiveContainer>
          <ChartCmp data={block.data} margin={{ top: 8, right: 16, bottom: 32, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="name" angle={-30} textAnchor="end" height={60} fontSize={11} />
            <YAxis fontSize={11} tickFormatter={(v) => v.toLocaleString("tr-TR")} />
            <Tooltip
              formatter={(v: any) =>
                typeof v === "number" ? v.toLocaleString("tr-TR", { maximumFractionDigits: 2 }) : v
              }
            />
            <SeriesCmp dataKey="value" fill="#2563eb" stroke="#2563eb" strokeWidth={2} dot />
          </ChartCmp>
        </ResponsiveContainer>
      </div>
      {(block.x_label || block.y_label) && (
        <div className="flex justify-between text-xs text-muted-foreground mt-1">
          <span>{block.x_label}</span>
          <span>{block.y_label}</span>
        </div>
      )}
    </div>
  );
}

function TableBlock({ block }: { block: Block }) {
  if (!block.headers || !block.rows) return null;
  return (
    <div className="rounded-md border overflow-x-auto mt-3">
      {block.title && <div className="text-sm font-medium px-3 py-2 border-b bg-muted/40">{block.title}</div>}
      <Table>
        <TableHeader>
          <TableRow>
            {block.headers.map((h, i) => (
              <TableHead key={i} className="text-xs">{h}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {block.rows.map((r, i) => (
            <TableRow key={i}>
              {r.map((cell, j) => (
                <TableCell key={j} className="text-sm">{fmtNum(cell)}</TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function TraceBlock({ calls }: { calls: ToolCall[] }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  if (!calls || calls.length === 0) return null;
  const dataCalls = calls.filter((c) => c.name !== "present_answer");
  const summary = dataCalls.length > 0
    ? dataCalls.map((c) => c.name).join(" → ")
    : "present_answer";

  return (
    <div className="mt-3 rounded-md border bg-muted/30">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
        data-testid="ask-trace-toggle"
      >
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        <span>{t('ask.howAiGot', { count: calls.length })}</span>
        <span className="ml-auto font-normal opacity-70 truncate">{summary}</span>
      </button>
      {open && (
        <div className="px-3 pb-3 pt-1 border-t space-y-2">
          {calls.map((c, i) => (
            <div key={i} className="text-[11px] font-mono">
              <div className="text-muted-foreground mb-0.5">
                <span className="text-blue-700 font-semibold">{i + 1}.</span> {c.name}
              </div>
              <pre className="bg-background border rounded px-2 py-1.5 overflow-x-auto whitespace-pre-wrap">
                {JSON.stringify(c.input, null, 2)}
              </pre>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Light markdown renderer (paragraphs + bold). The model is told to keep answers short markdown.
function renderMarkdown(text: string): React.ReactNode {
  const paragraphs = text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  return paragraphs.map((p, i) => {
    const parts = p.split(/(\*\*[^*]+\*\*)/g);
    return (
      <p key={i} className="text-sm leading-relaxed mb-2 whitespace-pre-wrap">
        {parts.map((part, j) =>
          part.startsWith("**") && part.endsWith("**") ? (
            <strong key={j}>{part.slice(2, -2)}</strong>
          ) : (
            <span key={j}>{part}</span>
          ),
        )}
      </p>
    );
  });
}

export default function AskPage() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const suggestions = t('ask.suggestions', { returnObjects: true }) as string[];
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isAsking, setIsAsking] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const ask = async (question: string) => {
    if (!question.trim() || isAsking) return;
    setMessages((prev) => [
      ...prev,
      { role: "user", text: question },
      { role: "assistant", text: "", pending: true },
    ]);
    setInput("");
    setIsAsking(true);

    try {
      const res = await apiRequest("POST", "/api/ask", {
        question,
        todayISO: new Date().toISOString().slice(0, 10),
      });
      if (!res.ok) {
        const body = await res.text();
        let msg = t('ask.failedStatus', { status: res.status });
        try { msg = JSON.parse(body).error ?? JSON.parse(body).detail ?? msg; } catch {}
        throw new Error(msg);
      }
      const data = await res.json();
      setMessages((prev) => {
        const next = [...prev];
        const last = next[next.length - 1];
        if (last?.role === "assistant" && last.pending) {
          next[next.length - 1] = {
            role: "assistant",
            text: data.answer ?? t('ask.noAnswer'),
            blocks: data.blocks,
            toolCalls: Array.isArray(data.tool_calls) ? data.tool_calls : undefined,
          };
        }
        return next;
      });
    } catch (err: any) {
      setMessages((prev) => {
        const next = [...prev];
        const last = next[next.length - 1];
        if (last?.role === "assistant" && last.pending) {
          next[next.length - 1] = {
            role: "assistant",
            text: t('ask.errorPrefix', { msg: err?.message ?? t('ask.requestFailed') }),
          };
        }
        return next;
      });
      toast({
        title: t('common.error'),
        description: err?.message ?? t('ask.requestFailed'),
        variant: "destructive",
      });
    } finally {
      setIsAsking(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    ask(input);
  };

  return (
    <PageLayout title={t('nav.askCnc')}>
      <div className="flex flex-col h-[calc(100vh-100px)] w-full max-w-screen-2xl mx-auto px-4 md:px-6 lg:px-8 py-4">
        <div className="mb-4">
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Sparkles className="h-6 w-6 text-blue-600" />
            {t('nav.askCnc')}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {t('ask.subtitle')}
          </p>
        </div>

        {/* Conversation */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto space-y-4 pr-2">
          {messages.length === 0 ? (
            <Card>
              <CardContent className="pt-6">
                <div className="text-sm font-medium mb-3">{t('ask.exampleQuestions')}</div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  {suggestions.map((q, i) => (
                    <Button
                      key={i}
                      variant="outline"
                      size="sm"
                      className="text-left justify-start h-auto py-2 whitespace-normal"
                      onClick={() => ask(q)}
                      disabled={isAsking}
                    >
                      {q}
                    </Button>
                  ))}
                </div>
              </CardContent>
            </Card>
          ) : (
            messages.map((m, i) => (
              <div key={i} className={`flex gap-3 ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                {m.role === "assistant" && (
                  <div className="flex-shrink-0 h-8 w-8 rounded-full bg-blue-100 flex items-center justify-center">
                    <Bot className="h-4 w-4 text-blue-600" />
                  </div>
                )}
                <div className={m.role === "user" ? "max-w-[640px]" : "flex-1 min-w-0"}>
                  <Card>
                    <CardContent className="pt-4 pb-4">
                      {m.pending ? (
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                          <Loader2 className="h-4 w-4 animate-spin" />
                          {t('ask.thinking')}
                        </div>
                      ) : (
                        <>
                          {m.role === "user" ? (
                            <p className="text-sm">{m.text}</p>
                          ) : (
                            renderMarkdown(m.text)
                          )}
                          {m.blocks?.map((b, bi) =>
                            b.type === "chart" ? (
                              <ChartBlock key={bi} block={b} />
                            ) : (
                              <TableBlock key={bi} block={b} />
                            ),
                          )}
                          {m.role === "assistant" && m.toolCalls && m.toolCalls.length > 0 && (
                            <TraceBlock calls={m.toolCalls} />
                          )}
                        </>
                      )}
                    </CardContent>
                  </Card>
                </div>
                {m.role === "user" && (
                  <div className="flex-shrink-0 h-8 w-8 rounded-full bg-muted flex items-center justify-center">
                    <UserIcon className="h-4 w-4" />
                  </div>
                )}
              </div>
            ))
          )}
        </div>

        {/* Input */}
        <form onSubmit={handleSubmit} className="mt-4 flex gap-2 items-end">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSubmit(e as any);
              }
            }}
            placeholder={t('ask.placeholder')}
            rows={2}
            disabled={isAsking}
            data-testid="ask-input"
            className="flex-1 resize-none"
          />
          <Button type="submit" disabled={!input.trim() || isAsking} data-testid="ask-submit">
            {isAsking ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </Button>
        </form>
      </div>
    </PageLayout>
  );
}
