import { useTranslation } from "react-i18next";
import { Redirect } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Mail } from "lucide-react";
import { PageLayout } from "@/components/layout/PageLayout";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { InboxTabs } from "@/components/inbox/InboxTabs";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import type { OtherMailsResponse, ProcedureActionItem } from "@/components/inbox/types";

export default function OtherMailsPage() {
  const { t, i18n } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user, isLoading: authLoading } = useAuth();

  const data = useQuery<OtherMailsResponse>({
    queryKey: ["/api/email/other"],
    queryFn: async () => (await apiRequest("GET", "/api/email/other")).json(),
    enabled: user?.role === "admin",
  });

  const toggleTodo = useMutation({
    mutationFn: async (item: ProcedureActionItem) => {
      // Yapılacaklar mailin kendi kaydında duruyor; o mailin listesini alıp
      // yalnızca bu maddeyi çevirip geri yazıyoruz.
      const email = await (await apiRequest("GET", `/api/email/messages/${item.emailId}`)).json();
      const actionItems = (email.actionItems ?? []).map((a: { id: string; done: boolean }) =>
        a.id === item.itemId ? { ...a, done: !item.done } : a,
      );
      return apiRequest("PATCH", `/api/email/messages/${item.emailId}`, { actionItems });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/email/other"] });
      queryClient.invalidateQueries({ queryKey: ["/api/email/threads"] });
      queryClient.invalidateQueries({ queryKey: ["/api/email/messages"] });
    },
    onError: () => toast({ variant: "destructive", description: t("otherMails.todos.saveFailed") }),
  });

  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }
  if (user?.role !== "admin") return <Redirect to="/dashboard" />;

  const actionItems = data.data?.actionItems ?? [];
  const openTodos = actionItems.filter((a) => !a.done);
  const doneTodos = actionItems.filter((a) => a.done);
  const threads = data.data?.threads ?? [];
  const isEmpty = threads.length === 0 && actionItems.length === 0;

  return (
    <PageLayout title={t("nav.emailInbox")}>
      <div className="space-y-4 p-4">
        <InboxTabs />

        {data.isLoading ? (
          <div className="flex justify-center p-8">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : data.isError ? (
          <p className="p-4 text-sm text-destructive">{t("otherMails.loadError")}</p>
        ) : isEmpty ? (
          <Card>
            <CardContent className="space-y-1 p-6">
              <p className="text-sm">{t("otherMails.empty")}</p>
              <p className="text-sm text-muted-foreground">{t("otherMails.emptyHelp")}</p>
            </CardContent>
          </Card>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">{t("otherMails.description")}</p>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">{t("otherMails.sections.todos")}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {actionItems.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t("otherMails.todos.empty")}</p>
                ) : (
                  <>
                    <ul className="space-y-2">
                      {openTodos.map((item) => (
                        <li key={`${item.emailId}-${item.itemId}`} className="flex items-start gap-2">
                          <Checkbox
                            id={`other-todo-${item.emailId}-${item.itemId}`}
                            checked={false}
                            disabled={toggleTodo.isPending}
                            onCheckedChange={() => toggleTodo.mutate(item)}
                          />
                          <label
                            htmlFor={`other-todo-${item.emailId}-${item.itemId}`}
                            className="text-sm leading-tight"
                          >
                            {item.text}
                            <span className="block text-xs text-muted-foreground">
                              {item.emailSubject}
                            </span>
                          </label>
                        </li>
                      ))}
                    </ul>

                    {doneTodos.length > 0 && (
                      <details>
                        <summary className="cursor-pointer text-xs text-muted-foreground">
                          {t("otherMails.todos.done")} ({doneTodos.length})
                        </summary>
                        <ul className="mt-2 space-y-2">
                          {doneTodos.map((item) => (
                            <li
                              key={`${item.emailId}-${item.itemId}`}
                              className="flex items-start gap-2"
                            >
                              <Checkbox
                                checked
                                disabled={toggleTodo.isPending}
                                onCheckedChange={() => toggleTodo.mutate(item)}
                              />
                              <span className="text-sm text-muted-foreground line-through">
                                {item.text}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}
                  </>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Mail className="h-4 w-4" />
                  {t("otherMails.sections.mails")}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {threads.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t("otherMails.mails.empty")}</p>
                ) : (
                  <ul className="divide-y">
                    {threads.map((thread) => (
                      <li key={thread.threadId} className="py-2">
                        <div className="flex items-start justify-between gap-2">
                          <span className="truncate text-sm font-medium">{thread.subject}</span>
                          <span className="shrink-0 text-xs text-muted-foreground">
                            {thread.lastSentAt
                              ? new Date(thread.lastSentAt).toLocaleDateString(i18n.language)
                              : ""}
                          </span>
                        </div>
                        <p className="text-sm text-muted-foreground">{thread.summary}</p>
                        <div className="mt-1 flex flex-wrap items-center gap-1">
                          {thread.messageCount > 1 && (
                            <Badge variant="secondary">
                              {t("emailInbox.thread.messageCount", { count: thread.messageCount })}
                            </Badge>
                          )}
                          {thread.urgency === "high" && (
                            <Badge variant="destructive">{t("emailInbox.urgency.high")}</Badge>
                          )}
                          <span className="text-xs text-muted-foreground">
                            {thread.fromName || thread.fromAddress}
                          </span>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </PageLayout>
  );
}
