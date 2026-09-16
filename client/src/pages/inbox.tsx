import { useEffect, useRef, useState } from "react";
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
import { ThreadList } from "@/components/inbox/ThreadList";
import { InboxTabs } from "@/components/inbox/InboxTabs";
import { EmailDetail } from "@/components/inbox/EmailDetail";
import { InboxFilters, EMPTY_FILTERS, type InboxFilterState } from "@/components/inbox/InboxFilters";
import type { AccountStatus, ThreadListResponse } from "@/components/inbox/types";

const PAGE_SIZE = 50;

function buildQueryString(filters: InboxFilterState, page: number): string {
  const params = new URLSearchParams();
  if (filters.status !== "all") params.set("status", filters.status);
  if (filters.urgency !== "all") params.set("urgency", filters.urgency);
  if (filters.category !== "all") params.set("category", filters.category);
  if (filters.matched !== "all") params.set("matched", filters.matched);
  if (filters.q.trim() !== "") params.set("q", filters.q.trim());
  params.set("limit", String(PAGE_SIZE));
  params.set("offset", String(page * PAGE_SIZE));
  return params.toString();
}

export default function InboxPage() {
  const { t, i18n } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user, isLoading: authLoading } = useAuth();

  const [filters, setFilters] = useState<InboxFilterState>(EMPTY_FILTERS);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [page, setPage] = useState(0);

  // Filtreler değişince sayfa 0'a dönsün; yoksa örneğin 3. sayfadayken
  // filtre değiştirince boş bir sonuç sayfası görünebilir.
  useEffect(() => {
    setPage(0);
  }, [filters]);

  const account = useQuery<AccountStatus>({
    queryKey: ["/api/email/account"],
    queryFn: async () => (await apiRequest("GET", "/api/email/account")).json(),
    // Senkron arka planda çalışırken kısa aralıklarla yoklayıp bittiğinde
    // mail listesini tazeleyebilelim (bkz. aşağıdaki useEffect).
    refetchInterval: (query) => (query.state.data?.syncing ? 5000 : false),
  });

  // Bağlıyken takip edilen firma sayısı: gün birinde hesap bağlı ama hiç
  // gönderen eklenmemişse kullanıcıyı bilgilendirmek için.
  const senders = useQuery<Array<{ active: boolean }>>({
    queryKey: ["/api/email/senders"],
    queryFn: async () => (await apiRequest("GET", "/api/email/senders")).json(),
    enabled: !!account.data?.connected,
  });
  const hasActiveSender = (senders.data ?? []).some((s) => s.active);

  const queryString = buildQueryString(filters, page);
  const messages = useQuery<ThreadListResponse>({
    queryKey: ["/api/email/threads", queryString, page],
    queryFn: async () => (await apiRequest("GET", `/api/email/threads?${queryString}`)).json(),
  });

  // Senkron artık arka planda çalışıyor (bkz. server/email/routes.ts POST /sync);
  // "çalışıyor"dan "bitti"ye geçişi yakalayıp mail listesini o an tazeliyoruz.
  const wasSyncing = useRef(false);
  useEffect(() => {
    const syncing = account.data?.syncing ?? false;
    if (wasSyncing.current && !syncing) {
      queryClient.invalidateQueries({ queryKey: ["/api/email/messages"] });
      queryClient.invalidateQueries({ queryKey: ["/api/email/threads"] });
    }
    wasSyncing.current = syncing;
  }, [account.data?.syncing, queryClient]);

  const sync = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/email/sync");
      return response.json();
    },
    onSuccess: () => {
      toast({ description: t("emailInbox.syncStarted") });
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

  const isSyncing = sync.isPending || Boolean(account.data?.syncing);

  const markRead = useMutation({
    mutationFn: async (id: number) =>
      apiRequest("PATCH", `/api/email/messages/${id}`, { status: "read" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/email/messages"] });
      queryClient.invalidateQueries({ queryKey: ["/api/email/threads"] });
    },
  });

  // Durumu çağıran taraf veriyor: seçilen mail bir konuşmanın içinden de
  // gelebiliyor ve o zaman listede karşılığı bulunmuyor. "done" olan bir maili
  // yeniden "read" yapmamak için yalnızca "new" olanı işaretliyoruz.
  const handleSelect = (id: number, status?: string) => {
    setSelectedId(id);
    if (status === "new") markRead.mutate(id);
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
        <InboxTabs />
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

        {account.data?.connected && !hasActiveSender && (
          <Card className="border-amber-400 p-4">
            <p className="font-medium">{t("emailInbox.noSenders")}</p>
            <p className="text-sm text-muted-foreground">{t("emailInbox.noSendersHelp")}</p>
            <Button className="mt-2" variant="outline" size="sm" asChild>
              <a href="/settings">{t("emailInbox.goToSettings")}</a>
            </Button>
          </Card>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2">
          <InboxFilters value={filters} onChange={setFilters} />
          <div className="flex items-center gap-3">
            <span className="text-xs text-muted-foreground">{lastSynced}</span>
            <Button size="sm" onClick={() => sync.mutate()} disabled={isSyncing}>
              <RefreshCw className={`mr-2 h-4 w-4 ${isSyncing ? "animate-spin" : ""}`} />
              {isSyncing ? t("emailInbox.syncing") : t("emailInbox.syncNow")}
            </Button>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-[360px_1fr]">
          <div className="space-y-2">
            <Card className="max-h-[70vh] overflow-y-auto">
              {messages.isLoading ? (
                <div className="flex justify-center p-6">
                  <Loader2 className="h-5 w-5 animate-spin" />
                </div>
              ) : messages.isError ? (
                <p className="p-4 text-sm text-destructive">{t("emailInbox.loadError")}</p>
              ) : (
                <ThreadList
                  items={messages.data?.items ?? []}
                  selectedId={selectedId}
                  onSelect={handleSelect}
                />
              )}
            </Card>

            {messages.data && messages.data.total > PAGE_SIZE && (
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  disabled={page === 0}
                >
                  {t("emailInbox.previous")}
                </Button>
                <span>
                  {t("emailInbox.pageInfo", {
                    from: page * PAGE_SIZE + 1,
                    to: Math.min((page + 1) * PAGE_SIZE, messages.data.total),
                    total: messages.data.total,
                  })}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => p + 1)}
                  disabled={(page + 1) * PAGE_SIZE >= messages.data.total}
                >
                  {t("emailInbox.next")}
                </Button>
              </div>
            )}
          </div>

          <Card className="max-h-[70vh] overflow-y-auto">
            <EmailDetail emailId={selectedId} />
          </Card>
        </div>
      </div>
    </PageLayout>
  );
}
