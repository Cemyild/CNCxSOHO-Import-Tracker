import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Loader2, Paperclip } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { apiRequest } from "@/lib/queryClient";
import type { MessageListItem, ThreadListItem } from "./types";

interface Props {
  items: ThreadListItem[];
  selectedId: number | null;
  onSelect: (id: number, status?: string) => void;
}

/** Bir konuşmanın içindeki mailler; yalnızca açıldığında yüklenir. */
function ThreadMessages({
  threadId,
  selectedId,
  onSelect,
}: {
  threadId: string;
  selectedId: number | null;
  onSelect: (id: number, status?: string) => void;
}) {
  const { t, i18n } = useTranslation();

  const messages = useQuery<MessageListItem[]>({
    queryKey: ["/api/email/threads", threadId],
    queryFn: async () => (await apiRequest("GET", `/api/email/threads/${threadId}`)).json(),
  });

  if (messages.isLoading) {
    return (
      <div className="flex justify-center py-2">
        <Loader2 className="h-4 w-4 animate-spin" />
      </div>
    );
  }
  if (messages.isError) {
    return <p className="px-3 py-2 text-xs text-destructive">{t("emailInbox.loadError")}</p>;
  }

  return (
    <ul className="border-t bg-muted/30">
      {(messages.data ?? []).map((message) => (
        <li key={message.id}>
          <button
            type="button"
            onClick={() => onSelect(message.id, message.status)}
            className={cn(
              "w-full px-3 py-2 pl-9 text-left hover:bg-muted/60",
              selectedId === message.id && "bg-muted",
            )}
          >
            <div className="flex items-start justify-between gap-2">
              <span
                className={cn("truncate text-xs", message.status === "new" && "font-semibold")}
              >
                {message.direction === "outgoing" && (
                  <Badge variant="outline" className="mr-1">
                    {t("emailInbox.sent")}
                  </Badge>
                )}
                {message.fromName || message.fromAddress}
              </span>
              <span className="shrink-0 text-[11px] text-muted-foreground">
                {message.sentAt ? new Date(message.sentAt).toLocaleDateString(i18n.language) : ""}
              </span>
            </div>
            <p className="truncate text-xs text-muted-foreground">
              {message.summary ?? message.subject}
            </p>
          </button>
        </li>
      ))}
    </ul>
  );
}

export function ThreadList({ items, selectedId, onSelect }: Props) {
  const { t, i18n } = useTranslation();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggle = (threadId: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(threadId)) next.delete(threadId);
      else next.add(threadId);
      return next;
    });
  };

  if (items.length === 0) {
    return <p className="p-4 text-sm text-muted-foreground">{t("emailInbox.empty")}</p>;
  }

  return (
    <ul className="divide-y">
      {items.map((thread) => {
        const isGroup = thread.messageCount > 1;
        const isOpen = expanded.has(thread.threadId);

        return (
          <li key={thread.threadId}>
            <div
              className={cn(
                "flex items-start gap-1 hover:bg-muted/60",
                selectedId === thread.latestEmailId && !isOpen && "bg-muted",
              )}
            >
              {isGroup ? (
                <button
                  type="button"
                  aria-label={
                    isOpen ? t("emailInbox.thread.collapse") : t("emailInbox.thread.expand")
                  }
                  className="mt-3 shrink-0 pl-2 text-muted-foreground"
                  onClick={() => toggle(thread.threadId)}
                >
                  {isOpen ? (
                    <ChevronDown className="h-4 w-4" />
                  ) : (
                    <ChevronRight className="h-4 w-4" />
                  )}
                </button>
              ) : (
                <span className="w-6 shrink-0" />
              )}

              <button
                type="button"
                onClick={() => (isGroup ? toggle(thread.threadId) : onSelect(thread.latestEmailId, thread.status))}
                className="w-full py-3 pr-3 text-left"
              >
                <div className="flex items-start justify-between gap-2">
                  <span
                    className={cn("truncate text-sm", thread.unreadCount > 0 && "font-semibold")}
                  >
                    {thread.fromName || thread.fromAddress}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {thread.lastSentAt
                      ? new Date(thread.lastSentAt).toLocaleDateString(i18n.language)
                      : ""}
                  </span>
                </div>

                <p className="truncate text-sm">{thread.subject}</p>

                <div className="mt-1 flex flex-wrap items-center gap-1">
                  {isGroup && (
                    <Badge variant="secondary">
                      {t("emailInbox.thread.messageCount", { count: thread.messageCount })}
                    </Badge>
                  )}
                  {thread.urgency === "high" && (
                    <Badge variant="destructive">{t("emailInbox.urgency.high")}</Badge>
                  )}
                  {thread.category && (
                    <Badge variant="secondary">
                      {t(`emailInbox.category.${thread.category}`)}
                    </Badge>
                  )}
                  {thread.procedureReference ? (
                    <Badge variant="outline">{thread.procedureReference}</Badge>
                  ) : (
                    <Badge variant="outline">{t("emailInbox.unmatched")}</Badge>
                  )}
                  {thread.openActionCount > 0 && (
                    <Badge variant="secondary">
                      {t("emailInbox.thread.openActions", { count: thread.openActionCount })}
                    </Badge>
                  )}
                  {thread.aiStatus === "failed" && (
                    <Badge variant="destructive">{t("emailInbox.aiFailed")}</Badge>
                  )}
                  {thread.aiStatus === "pending" && (
                    <Badge variant="secondary">{t("emailInbox.aiPending")}</Badge>
                  )}
                  {thread.hasAttachments && (
                    <Paperclip className="h-3.5 w-3.5 text-muted-foreground" />
                  )}
                </div>
              </button>
            </div>

            {isGroup && isOpen && (
              <ThreadMessages
                threadId={thread.threadId}
                selectedId={selectedId}
                onSelect={onSelect}
              />
            )}
          </li>
        );
      })}
    </ul>
  );
}
