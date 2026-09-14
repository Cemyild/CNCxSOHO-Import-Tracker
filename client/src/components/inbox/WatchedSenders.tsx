import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

interface Sender {
  id: number;
  pattern: string;
  label: string | null;
  active: boolean;
}

export function WatchedSenders() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [pattern, setPattern] = useState("");
  const [label, setLabel] = useState("");

  const senders = useQuery<Sender[]>({
    queryKey: ["/api/email/senders"],
    queryFn: async () => (await apiRequest("GET", "/api/email/senders")).json(),
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["/api/email/senders"] });

  const add = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/email/senders", { pattern, label });
      return response.json();
    },
    onSuccess: () => {
      toast({ description: t("mailSettings.senders.added") });
      setPattern("");
      setLabel("");
      invalidate();
    },
    onError: (error: Error) =>
      toast({
        variant: "destructive",
        description: error.message.startsWith("409")
          ? t("mailSettings.senders.duplicate")
          : t("mailSettings.senders.invalid"),
      }),
  });

  const toggle = useMutation({
    mutationFn: async (input: { id: number; active: boolean }) =>
      apiRequest("PATCH", `/api/email/senders/${input.id}`, { active: input.active }),
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: async (id: number) => apiRequest("DELETE", `/api/email/senders/${id}`),
    onSuccess: () => {
      toast({ description: t("mailSettings.senders.removed") });
      invalidate();
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("mailSettings.senders.title")}</CardTitle>
        <CardDescription>{t("mailSettings.senders.description")}</CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (pattern.trim() !== "") add.mutate();
          }}
        >
          <Input
            className="w-[260px]"
            placeholder={t("mailSettings.senders.placeholder")}
            value={pattern}
            onChange={(e) => setPattern(e.target.value)}
          />
          <Input
            className="w-[200px]"
            placeholder={t("mailSettings.senders.labelPlaceholder")}
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
          <Button type="submit" size="sm" disabled={add.isPending}>
            {t("mailSettings.senders.add")}
          </Button>
        </form>

        {(senders.data ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("mailSettings.senders.empty")}</p>
        ) : (
          <ul className="divide-y">
            {(senders.data ?? []).map((sender) => (
              <li key={sender.id} className="flex items-center gap-3 py-2">
                <div className="flex-1">
                  <p className="text-sm">{sender.pattern}</p>
                  {sender.label && (
                    <p className="text-xs text-muted-foreground">{sender.label}</p>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <Switch
                    checked={sender.active}
                    aria-label={t("mailSettings.senders.active")}
                    onCheckedChange={(active) => toggle.mutate({ id: sender.id, active })}
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={t("mailSettings.senders.remove")}
                    onClick={() => {
                      if (window.confirm(t("mailSettings.senders.removeConfirm"))) {
                        remove.mutate(sender.id);
                      }
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
