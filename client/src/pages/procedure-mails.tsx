import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Redirect } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ExternalLink, FileText, Loader2, Mail, Paperclip } from "lucide-react";
import { PageLayout } from "@/components/layout/PageLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { InboxTabs } from "@/components/inbox/InboxTabs";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import type {
  ProcedureActionItem,
  ProcedureMailDetail,
  ProcedureMailSummary,
} from "@/components/inbox/types";

function ProcedureTable({
  items,
  onOpen,
}: {
  items: ProcedureMailSummary[];
  onOpen: (id: number) => void;
}) {
  const { t, i18n } = useTranslation();

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="border-b text-left text-xs text-muted-foreground">
          <tr>
            <th className="px-3 py-2">{t("procedureMails.columns.reference")}</th>
            <th className="px-3 py-2">{t("procedureMails.columns.shipper")}</th>
            <th className="px-3 py-2 text-right">{t("procedureMails.columns.mails")}</th>
            <th className="px-3 py-2 text-right">{t("procedureMails.columns.todos")}</th>
            <th className="px-3 py-2 text-right">{t("procedureMails.columns.attachments")}</th>
            <th className="px-3 py-2">{t("procedureMails.columns.lastMail")}</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {items.map((item) => (
            <tr
              key={item.procedureId}
              className="cursor-pointer hover:bg-muted/60"
              onClick={() => onOpen(item.procedureId)}
            >
              <td className="px-3 py-2 font-medium">
                {item.reference}
                {item.unreadCount > 0 && (
                  <Badge className="ml-2" variant="secondary">
                    {item.unreadCount}
                  </Badge>
                )}
              </td>
              <td className="max-w-[240px] truncate px-3 py-2 text-muted-foreground">
                {item.shipper}
              </td>
              <td className="px-3 py-2 text-right">{item.messageCount}</td>
              <td className="px-3 py-2 text-right">
                {item.openActionCount > 0 ? (
                  <Badge variant="destructive">{item.openActionCount}</Badge>
                ) : (
                  0
                )}
              </td>
              <td className="px-3 py-2 text-right">{item.pendingAttachmentCount}</td>
              <td className="px-3 py-2 text-muted-foreground">
                {item.lastMailAt
                  ? new Date(item.lastMailAt).toLocaleDateString(i18n.language)
                  : ""}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ProcedureDetail({ procedureId, onBack }: { procedureId: number; onBack: () => void }) {
  const { t, i18n } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const detail = useQuery<ProcedureMailDetail>({
    queryKey: ["/api/email/procedures", procedureId],
    queryFn: async () => (await apiRequest("GET", `/api/email/procedures/${procedureId}`)).json(),
  });

  const toggleTodo = useMutation({
    mutationFn: async (item: ProcedureActionItem) => {
      // Yapılacaklar mailin kendi kaydında duruyor; o mailin listesini alıp
      // yalnızca bu maddeyi çevirip geri yazıyoruz.
      const email = await (await apiRequest("GET", `/api/email/messages/${item.emailId}`)).json();
      const actionItems = (email.actionItems ?? []).map((a: ProcedureActionItem & { id: string }) =>
        a.id === item.itemId ? { ...a, done: !item.done } : a,
      );
      return apiRequest("PATCH", `/api/email/messages/${item.emailId}`, { actionItems });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/email/procedures", procedureId] });
      queryClient.invalidateQueries({ queryKey: ["/api/email/threads"] });
      queryClient.invalidateQueries({ queryKey: ["/api/email/messages"] });
    },
    onError: () =>
      toast({ variant: "destructive", description: t("procedureMails.todos.saveFailed") }),
  });

  if (detail.isLoading) {
    return (
      <div className="flex justify-center p-8">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }
  if (detail.isError || !detail.data) {
    return <p className="p-4 text-sm text-destructive">{t("procedureMails.loadError")}</p>;
  }

  const { summary, documents, actionItems, threads } = detail.data;
  const openTodos = actionItems.filter((a) => !a.done);
  const doneTodos = actionItems.filter((a) => a.done);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          {t("procedureMails.backToList")}
        </Button>
        <h2 className="text-lg font-semibold">{summary.reference}</h2>
        <span className="text-sm text-muted-foreground">{summary.shipper}</span>
        <Button variant="outline" size="sm" asChild>
          <a href={`/procedure-details?id=${summary.procedureId}`}>
            <ExternalLink className="mr-2 h-4 w-4" />
            {summary.reference}
          </a>
        </Button>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <FileText className="h-4 w-4" />
              {t("procedureMails.sections.documents")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {documents.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {t("procedureMails.documents.empty")}
              </p>
            ) : (
              <ul className="divide-y">
                {documents.map((doc) => (
                  <li key={`${doc.source}-${doc.id}`} className="flex items-center gap-2 py-2">
                    <Paperclip className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="flex-1 truncate text-sm">{doc.name}</span>
                    <Badge variant={doc.source === "email" ? "secondary" : "outline"}>
                      {doc.source === "email"
                        ? t("procedureMails.documents.fromMail")
                        : t("procedureMails.documents.fromProcedure")}
                    </Badge>
                    {doc.source === "email" && doc.status && (
                      <Badge variant={doc.status === "saved" ? "outline" : "secondary"}>
                        {t(`procedureMails.documents.${doc.status}`)}
                      </Badge>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{t("procedureMails.sections.todos")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {actionItems.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("procedureMails.todos.empty")}</p>
            ) : (
              <>
                <ul className="space-y-2">
                  {openTodos.map((item) => (
                    <li key={`${item.emailId}-${item.itemId}`} className="flex items-start gap-2">
                      <Checkbox
                        id={`todo-${item.emailId}-${item.itemId}`}
                        checked={false}
                        disabled={toggleTodo.isPending}
                        onCheckedChange={() => toggleTodo.mutate(item)}
                      />
                      <label
                        htmlFor={`todo-${item.emailId}-${item.itemId}`}
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
                      {t("procedureMails.todos.done")} ({doneTodos.length})
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
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Mail className="h-4 w-4" />
            {t("procedureMails.sections.mails")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {threads.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("procedureMails.mails.empty")}</p>
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
                    <Button variant="ghost" size="sm" asChild>
                      <a href="/inbox">{t("procedureMails.mails.open")}</a>
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function ProcedureMailsPage() {
  const { t } = useTranslation();
  const { user, isLoading: authLoading } = useAuth();
  const [openId, setOpenId] = useState<number | null>(null);

  const procedures = useQuery<ProcedureMailSummary[]>({
    queryKey: ["/api/email/procedures"],
    queryFn: async () => (await apiRequest("GET", "/api/email/procedures")).json(),
    enabled: user?.role === "admin",
  });

  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }
  if (user?.role !== "admin") return <Redirect to="/dashboard" />;

  return (
    <PageLayout title={t("nav.emailInbox")}>
      <div className="space-y-4 p-4">
        <InboxTabs />
        {openId === null ? (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">{t("procedureMails.title")}</CardTitle>
              <p className="text-sm text-muted-foreground">{t("procedureMails.description")}</p>
            </CardHeader>
            <CardContent className="px-0">
              {procedures.isLoading ? (
                <div className="flex justify-center p-6">
                  <Loader2 className="h-5 w-5 animate-spin" />
                </div>
              ) : procedures.isError ? (
                <p className="px-4 text-sm text-destructive">{t("procedureMails.loadError")}</p>
              ) : (procedures.data ?? []).length === 0 ? (
                <div className="px-4">
                  <p className="text-sm">{t("procedureMails.empty")}</p>
                  <p className="text-sm text-muted-foreground">{t("procedureMails.emptyHelp")}</p>
                </div>
              ) : (
                <ProcedureTable items={procedures.data ?? []} onOpen={setOpenId} />
              )}
            </CardContent>
          </Card>
        ) : (
          <ProcedureDetail procedureId={openId} onBack={() => setOpenId(null)} />
        )}
      </div>
    </PageLayout>
  );
}
