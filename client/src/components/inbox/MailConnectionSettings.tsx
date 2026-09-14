import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import type { AccountStatus } from "./types";

export function MailConnectionSettings() {
  const { t, i18n } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const account = useQuery<AccountStatus>({
    queryKey: ["/api/email/account"],
    queryFn: async () => (await apiRequest("GET", "/api/email/account")).json(),
  });

  // OAuth callback returns to /settings?mail=connected or ?mail=error
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const result = params.get("mail");
    if (!result) return;

    toast(
      result === "connected"
        ? { description: t("mailSettings.connectSuccess") }
        : { variant: "destructive", description: t("mailSettings.connectError") },
    );
    queryClient.invalidateQueries({ queryKey: ["/api/email/account"] });
    window.history.replaceState({}, "", window.location.pathname);
  }, [queryClient, t, toast]);

  const connect = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("GET", "/api/email/google/auth-url");
      return (await response.json()) as { url: string };
    },
    onSuccess: ({ url }) => {
      window.location.href = url;
    },
    onError: () => toast({ variant: "destructive", description: t("mailSettings.connectError") }),
  });

  const disconnect = useMutation({
    mutationFn: async () => apiRequest("DELETE", "/api/email/account"),
    onSuccess: () => {
      toast({ description: t("mailSettings.disconnected") });
      queryClient.invalidateQueries({ queryKey: ["/api/email/account"] });
    },
  });

  const data = account.data;
  const lastSynced = data?.lastSyncedAt
    ? t("mailSettings.lastSynced", { time: new Date(data.lastSyncedAt).toLocaleString(i18n.language) })
    : t("mailSettings.neverSynced");

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Mail className="h-5 w-5" />
          {t("mailSettings.title")}
        </CardTitle>
        <CardDescription>{t("mailSettings.description")}</CardDescription>
      </CardHeader>

      <CardContent className="space-y-3">
        {data?.connected ? (
          <>
            <p className="text-sm">{t("mailSettings.connected", { email: data.emailAddress })}</p>
            <p className="text-xs text-muted-foreground">{lastSynced}</p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                if (window.confirm(t("mailSettings.disconnectConfirm"))) disconnect.mutate();
              }}
            >
              {t("mailSettings.disconnect")}
            </Button>
          </>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              {data?.status === "error" ? t("mailSettings.statusError") : t("mailSettings.notConnected")}
            </p>
            <Button size="sm" onClick={() => connect.mutate()} disabled={connect.isPending}>
              {data?.status === "error" ? t("mailSettings.reconnect") : t("mailSettings.connect")}
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
