import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import type { AccountStatus } from "./types";

const APP_PASSWORD_URL = "https://myaccount.google.com/apppasswords";

export function MailConnectionSettings() {
  const { t, i18n } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [emailAddress, setEmailAddress] = useState("");
  const [appPassword, setAppPassword] = useState("");

  const account = useQuery<AccountStatus>({
    queryKey: ["/api/email/account"],
    queryFn: async () => (await apiRequest("GET", "/api/email/account")).json(),
  });

  const connect = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/email/account", {
        emailAddress,
        appPassword,
      });
      return response.json();
    },
    onSuccess: () => {
      toast({ description: t("mailSettings.connectSuccess") });
      setAppPassword("");
      queryClient.invalidateQueries({ queryKey: ["/api/email/account"] });
    },
    onError: (error: Error) => {
      // Sunucu, IMAP hatasını zaten anlaşılır Türkçeye çevirip gönderiyor;
      // mesaj "<durum>: <gövde>" biçiminde geldiği için gövdesini ayıklıyoruz.
      const detail = error.message.replace(/^\d{3}:\s*/, "").trim();
      let description = t("mailSettings.connectError");
      try {
        const parsed = JSON.parse(detail);
        if (typeof parsed?.message === "string") description = parsed.message;
      } catch {
        if (detail !== "") description = detail;
      }
      toast({ variant: "destructive", description });
    },
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
    ? t("mailSettings.lastSynced", {
        time: new Date(data.lastSyncedAt).toLocaleString(i18n.language),
      })
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
            <p className="text-xs text-muted-foreground">{t("mailSettings.revokeHint")}</p>
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
          <form
            className="space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              if (emailAddress.trim() !== "" && appPassword.trim() !== "") connect.mutate();
            }}
          >
            {data?.status === "error" && (
              <p className="text-sm text-destructive">{t("mailSettings.statusError")}</p>
            )}

            <div className="space-y-1">
              <Label htmlFor="mail-address">{t("mailSettings.emailLabel")}</Label>
              <Input
                id="mail-address"
                type="email"
                autoComplete="username"
                className="max-w-sm"
                placeholder={t("mailSettings.emailPlaceholder")}
                value={emailAddress}
                onChange={(e) => setEmailAddress(e.target.value)}
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="mail-app-password">{t("mailSettings.passwordLabel")}</Label>
              <Input
                id="mail-app-password"
                type="password"
                autoComplete="new-password"
                className="max-w-sm"
                placeholder={t("mailSettings.passwordPlaceholder")}
                value={appPassword}
                onChange={(e) => setAppPassword(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">{t("mailSettings.passwordHelp")}</p>
              <a
                className="inline-flex items-center gap-1 text-xs text-primary underline"
                href={APP_PASSWORD_URL}
                target="_blank"
                rel="noreferrer"
              >
                {t("mailSettings.passwordHelpLink")}
                <ExternalLink className="h-3 w-3" />
              </a>
            </div>

            <p className="text-xs text-muted-foreground">{t("mailSettings.imapHint")}</p>

            <Button
              type="submit"
              size="sm"
              disabled={
                connect.isPending || emailAddress.trim() === "" || appPassword.trim() === ""
              }
            >
              {connect.isPending
                ? t("mailSettings.connecting")
                : data?.status === "error"
                  ? t("mailSettings.reconnect")
                  : t("mailSettings.connect")}
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
