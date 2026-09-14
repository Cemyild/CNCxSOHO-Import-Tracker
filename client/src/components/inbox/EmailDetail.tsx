import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { AttachmentActions } from "./AttachmentActions";
import type { ActionItem, MessageDetail } from "./types";

interface Props {
  emailId: number | null;
}

interface ProcedureOption {
  id: number;
  reference: string | null;
  shipper: string | null;
}

export function EmailDetail({ emailId }: Props) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [showOriginal, setShowOriginal] = useState(false);

  const detail = useQuery<MessageDetail>({
    queryKey: ["/api/email/messages", emailId],
    queryFn: async () => (await apiRequest("GET", `/api/email/messages/${emailId}`)).json(),
    enabled: emailId !== null,
  });

  // GET /api/procedures returns { procedures: [...] }, not a bare array.
  const procedures = useQuery<ProcedureOption[]>({
    queryKey: ["/api/procedures"],
    queryFn: async () => {
      const data = await (await apiRequest("GET", "/api/procedures")).json();
      return Array.isArray(data) ? data : (data?.procedures ?? []);
    },
  });

  const patch = useMutation<Response, Error, Record<string, unknown>, { previous?: MessageDetail }>({
    mutationFn: async (body: Record<string, unknown>) =>
      apiRequest("PATCH", `/api/email/messages/${emailId}`, body),

    // Yapılacaklar listesinde art arda tik atılabiliyor; her istek listenin
    // tamamını gönderdiği için önbelleği hemen güncellemezsek ikinci tik
    // birincisini geri alır.
    onMutate: async (body: Record<string, unknown>) => {
      if (!Array.isArray((body as any).actionItems)) return { previous: undefined };
      await queryClient.cancelQueries({ queryKey: ["/api/email/messages", emailId] });
      const previous = queryClient.getQueryData<MessageDetail>(["/api/email/messages", emailId]);
      if (previous) {
        queryClient.setQueryData<MessageDetail>(["/api/email/messages", emailId], {
          ...previous,
          actionItems: (body as any).actionItems,
        });
      }
      return { previous };
    },

    onError: (_error, _body, context) => {
      if (context?.previous) {
        queryClient.setQueryData(["/api/email/messages", emailId], context.previous);
      }
      toast({ variant: "destructive", description: t("emailInbox.detail.saveFailed") });
    },

    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/email/messages", emailId] });
      queryClient.invalidateQueries({ queryKey: ["/api/email/messages"] });
    },
  });

  const reprocess = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", `/api/email/messages/${emailId}/reprocess`);
      return response.json();
    },
    onSuccess: (result: { skipped?: "no-account" | "no-senders" | "error" }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/email/messages", emailId] });
      queryClient.invalidateQueries({ queryKey: ["/api/email/messages"] });

      // /reprocess resets the row then runs a synchronous sync round; that
      // round can itself be a no-op (disconnected account, empty sender
      // list) or fail outright, and the "özetlenemedi" badge would then
      // never move again unless we surface that here.
      if (result.skipped === "no-senders") {
        toast({ variant: "destructive", description: t("emailInbox.noSendersHelp") });
      } else if (result.skipped === "no-account") {
        toast({ variant: "destructive", description: t("emailInbox.notConnectedHelp") });
      } else if (result.skipped === "error") {
        toast({ variant: "destructive", description: t("emailInbox.syncFailed") });
      } else {
        toast({ description: t("emailInbox.detail.retryQueued") });
      }
    },
    onError: (error: Error) => {
      toast({
        variant: "destructive",
        description: error.message.startsWith("409") ? t("emailInbox.syncBusy") : t("emailInbox.detail.saveFailed"),
      });
    },
  });

  if (emailId === null) {
    return <p className="p-4 text-sm text-muted-foreground">{t("emailInbox.detail.selectPrompt")}</p>;
  }
  if (detail.isLoading) {
    return (
      <div className="flex justify-center p-6">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }
  if (detail.isError || !detail.data) {
    return <p className="p-4 text-sm text-destructive">{t("emailInbox.loadError")}</p>;
  }

  const email = detail.data;
  const actionItems: ActionItem[] = email.actionItems ?? [];

  const toggleActionItem = (id: string, done: boolean) => {
    patch.mutate({
      actionItems: actionItems.map((item) => (item.id === id ? { ...item, done } : item)),
    });
  };

  return (
    <div className="space-y-5 p-4">
      <header className="space-y-1">
        <h2 className="text-lg font-semibold">{email.subject}</h2>
        <p className="text-sm text-muted-foreground">
          {email.fromName} &lt;{email.fromAddress}&gt;
          {email.sentAt ? ` · ${new Date(email.sentAt).toLocaleString()}` : ""}
        </p>
        <div className="flex flex-wrap gap-2 pt-1">
          {email.urgency && (
            <Badge variant={email.urgency === "high" ? "destructive" : "secondary"}>
              {t(`emailInbox.urgency.${email.urgency}`)}
            </Badge>
          )}
          {email.category && <Badge variant="secondary">{t(`emailInbox.category.${email.category}`)}</Badge>}
          <Badge variant="outline">{t(`emailInbox.status.${email.status}`)}</Badge>
        </div>
      </header>

      <section>
        <h3 className="text-sm font-medium">{t("emailInbox.detail.summary")}</h3>
        {email.aiStatus === "failed" ? (
          <div className="flex items-center gap-2">
            <p className="text-sm text-destructive">{t("emailInbox.aiFailed")}</p>
            <Button size="sm" variant="outline" onClick={() => reprocess.mutate()} disabled={reprocess.isPending}>
              {t("emailInbox.detail.retry")}
            </Button>
          </div>
        ) : (
          <p className="text-sm">{email.summary ?? t("emailInbox.aiPending")}</p>
        )}
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-medium">{t("emailInbox.detail.actionItems")}</h3>
        {actionItems.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("emailInbox.detail.noActionItems")}</p>
        ) : (
          <ul className="space-y-2">
            {actionItems.map((item) => (
              <li key={item.id} className="flex items-start gap-2">
                <Checkbox
                  id={`action-${item.id}`}
                  checked={item.done}
                  onCheckedChange={(checked) => toggleActionItem(item.id, checked === true)}
                />
                <label htmlFor={`action-${item.id}`} className="text-sm leading-tight">
                  {item.text}
                </label>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-medium">{t("emailInbox.detail.match")}</h3>
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={email.procedureId ? String(email.procedureId) : ""}
            onValueChange={(value) => patch.mutate({ procedureId: Number(value) })}
          >
            <SelectTrigger className="w-[280px]" aria-label={t("emailInbox.detail.selectProcedure")}>
              <SelectValue placeholder={t("emailInbox.detail.selectProcedure")} />
            </SelectTrigger>
            <SelectContent>
              {(procedures.data ?? [])
                .filter((p) => p.reference)
                .map((p) => (
                  <SelectItem key={p.id} value={String(p.id)}>
                    {p.reference} {p.shipper ? `— ${p.shipper}` : ""}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>

          {email.procedureId && (
            <>
              <Button variant="outline" size="sm" asChild>
                <a href={`/procedure-details?id=${email.procedureId}`}>{email.procedureReference}</a>
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => patch.mutate({ procedureId: null })}
              >
                {t("emailInbox.detail.clearMatch")}
              </Button>
            </>
          )}
        </div>
        {email.matchReason && (
          <p className="text-xs text-muted-foreground">
            {t("emailInbox.detail.matchReason")}: {email.matchReason}
          </p>
        )}
      </section>

      <AttachmentActions
        emailId={email.id}
        attachments={email.attachments}
        defaultProcedureId={email.procedureId}
      />

      <section className="flex flex-wrap gap-2 border-t pt-3">
        {email.status !== "done" ? (
          <Button size="sm" onClick={() => patch.mutate({ status: "done" })}>
            {t("emailInbox.detail.markDone")}
          </Button>
        ) : (
          <Button size="sm" variant="outline" onClick={() => patch.mutate({ status: "read" })}>
            {t("emailInbox.detail.reopen")}
          </Button>
        )}

        {email.gmailThreadId && (
          <Button size="sm" variant="outline" asChild>
            <a
              href={`https://mail.google.com/mail/u/0/#inbox/${email.gmailThreadId}`}
              target="_blank"
              rel="noreferrer"
            >
              <ExternalLink className="mr-2 h-4 w-4" />
              {t("emailInbox.detail.openInGmail")}
            </a>
          </Button>
        )}

        <Button size="sm" variant="ghost" onClick={() => setShowOriginal((v) => !v)}>
          {showOriginal ? t("emailInbox.detail.hideOriginal") : t("emailInbox.detail.showOriginal")}
        </Button>
      </section>

      {showOriginal && (
        <pre className="max-h-[300px] overflow-auto whitespace-pre-wrap rounded bg-muted p-3 text-xs">
          {email.bodyText}
        </pre>
      )}
    </div>
  );
}
