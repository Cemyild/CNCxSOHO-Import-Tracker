import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Redirect } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw, Loader2 } from "lucide-react";
import { PageLayout } from "@/components/layout/PageLayout";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { EmailList } from "@/components/inbox/EmailList";
import { EmailDetail } from "@/components/inbox/EmailDetail";
import { InboxFilters, EMPTY_FILTERS, type InboxFilterState } from "@/components/inbox/InboxFilters";
import type { AccountStatus, MessageListResponse } from "@/components/inbox/types";

function buildQueryString(filters: InboxFilterState): string {
  const params = new URLSearchParams();
  if (filters.status !== "all") params.set("status", filters.status);
  if (filters.urgency !== "all") params.set("urgency", filters.urgency);
  if (filters.category !== "all") params.set("category", filters.category);
  if (filters.matched !== "all") params.set("matched", filters.matched);
  if (filters.q.trim() !== "") params.set("q", filters.q.trim());
  return params.toString();
}

export default function InboxPage() {
  const { t, i18n } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user, isLoading: authLoading } = useAuth();

  const [filters, setFilters] = useState<InboxFilterState>(EMPTY_FILTERS);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const account = useQuery<AccountStatus>({
    queryKey: ["/api/email/account"],
    queryFn: async () => (await apiRequest("GET", "/api/email/account")).json(),
  });

  const queryString = buildQueryString(filters);
  const messages = useQuery<MessageListResponse>({
    queryKey: ["/api/email/messages", queryString],
    queryFn: async () =>
      (await apiRequest("GET", `/api/email/messages${queryString ? `?${queryString}` : ""}`)).json(),
  });

  const sync = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/email/sync");
      return response.json();
    },
    onSuccess: (result: { inserted: number; processed: number }) => {
      toast({
        description: t("emailInbox.syncDone", {
          inserted: result.inserted ?? 0,
          processed: result.processed ?? 0,
        }),
      });
      queryClient.invalidateQueries({ queryKey: ["/api/email/messages"] });
      queryClient.invalidateQueries({ queryKey: ["/api/email/account"] });
    },
    onError: (error: Error) => {
      // apiRequest throws `${status}: ${body}` for non-2xx responses, so a
      // sync-already-running 409 is detected from the message prefix here.
      toast({
        variant: "destructive",
        description: error.message.startsWith("409") ? t("emailInbox.syncBusy") : t("emailInbox.loadError"),
      });
    },
  });

  const markRead = useMutation({
    mutationFn: async (id: number) =>
      apiRequest("PATCH", `/api/email/messages/${id}`, { status: "read" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/email/messages"] }),
  });

  const handleSelect = (id: number) => {
    setSelectedId(id);
    const item = messages.data?.items.find((m) => m.id === id);
    if (item?.status === "new") markRead.mutate(id);
  };

  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }
  if (user?.role !== "admin") return <Redirect to="/dashboard" />;

  const lastSynced = account.data?.lastSyncedAt
    ? t("emailInbox.lastSynced", {
        time: new Date(account.data.lastSyncedAt).toLocaleString(i18n.language),
      })
    : t("emailInbox.neverSynced");

  return (
    <PageLayout title={t("nav.emailInbox")}>
      <div className="space-y-4 p-4">
        {account.data && !account.data.connected && (
          <Card className="border-amber-400 p-4">
            <p className="font-medium">{t("emailInbox.notConnected")}</p>
            <p className="text-sm text-muted-foreground">{t("emailInbox.notConnectedHelp")}</p>
            <Button className="mt-2" variant="outline" size="sm" asChild>
              <a href="/settings">{t("emailInbox.goToSettings")}</a>
            </Button>
          </Card>
        )}

        {account.data?.status === "error" && (
          <Card className="border-destructive p-4">
            <p className="text-sm">{t("emailInbox.connectionLost")}</p>
          </Card>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2">
          <InboxFilters value={filters} onChange={setFilters} />
          <div className="flex items-center gap-3">
            <span className="text-xs text-muted-foreground">{lastSynced}</span>
            <Button size="sm" onClick={() => sync.mutate()} disabled={sync.isPending}>
              <RefreshCw className={`mr-2 h-4 w-4 ${sync.isPending ? "animate-spin" : ""}`} />
              {sync.isPending ? t("emailInbox.syncing") : t("emailInbox.syncNow")}
            </Button>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-[360px_1fr]">
          <Card className="max-h-[70vh] overflow-y-auto">
            {messages.isLoading ? (
              <div className="flex justify-center p-6">
                <Loader2 className="h-5 w-5 animate-spin" />
              </div>
            ) : messages.isError ? (
              <p className="p-4 text-sm text-destructive">{t("emailInbox.loadError")}</p>
            ) : (
              <EmailList
                items={messages.data?.items ?? []}
                selectedId={selectedId}
                onSelect={handleSelect}
              />
            )}
          </Card>

          <Card className="max-h-[70vh] overflow-y-auto">
            <EmailDetail emailId={selectedId} />
          </Card>
        </div>
      </div>
    </PageLayout>
  );
}
