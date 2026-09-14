import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Paperclip } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import type { AttachmentItem } from "./types";

interface Props {
  emailId: number;
  attachments: AttachmentItem[];
  defaultProcedureId: number | null;
}

export function AttachmentActions({ emailId, attachments, defaultProcedureId }: Props) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [documentType, setDocumentType] = useState<string>("");

  const documentTypes = useQuery<Array<{ id: number; name: string }>>({
    queryKey: ["/api/email/document-types"],
    queryFn: async () => (await apiRequest("GET", "/api/email/document-types")).json(),
  });

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["/api/email/messages", emailId] });

  const save = useMutation({
    mutationFn: async (attachmentId: number) => {
      const response = await apiRequest("POST", `/api/email/attachments/${attachmentId}/save`, {
        procedureId: defaultProcedureId,
        documentType,
      });
      return response.json();
    },
    onSuccess: () => {
      toast({ description: t("emailInbox.detail.attachmentSaved") });
      invalidate();
    },
    onError: (error: Error) => {
      // apiRequest throws `${status}: ${body}` for non-2xx responses, so the
      // status is read off the message prefix rather than a response object.
      const tooLarge = error.message.startsWith("413");
      const alreadyHandled = error.message.startsWith("409");
      toast({
        variant: "destructive",
        description: tooLarge
          ? t("emailInbox.detail.tooLarge")
          : alreadyHandled
            ? t("emailInbox.detail.attachmentAlreadyHandled")
            : t("emailInbox.detail.saveFailed"),
      });
    },
  });

  const dismiss = useMutation({
    mutationFn: async (attachmentId: number) =>
      apiRequest("POST", `/api/email/attachments/${attachmentId}/dismiss`),
    onSuccess: () => {
      toast({ description: t("emailInbox.detail.attachmentDismissed") });
      invalidate();
    },
    onError: () => {
      toast({ variant: "destructive", description: t("emailInbox.detail.saveFailed") });
    },
  });

  if (attachments.length === 0) return null;

  return (
    <section className="space-y-2">
      <h3 className="text-sm font-medium">{t("emailInbox.attachments")}</h3>

      <Select value={documentType} onValueChange={setDocumentType}>
        <SelectTrigger className="w-[220px]" aria-label={t("emailInbox.detail.documentType")}>
          <SelectValue placeholder={t("emailInbox.detail.documentType")} />
        </SelectTrigger>
        <SelectContent>
          {(documentTypes.data ?? []).map((type) => (
            <SelectItem key={type.id} value={type.name}>{type.name}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      <ul className="space-y-2">
        {attachments.map((attachment) => (
          <li key={attachment.id} className="flex flex-wrap items-center gap-2 rounded border p-2">
            <Paperclip className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm">{attachment.filename}</span>
            <span className="text-xs text-muted-foreground">
              {attachment.sizeBytes ? `${Math.round(attachment.sizeBytes / 1024)} KB` : ""}
            </span>

            {attachment.status === "saved" ? (
              <span className="text-xs text-emerald-600">
                {t("emailInbox.detail.attachmentSaved")}
              </span>
            ) : attachment.status === "dismissed" ? (
              <span className="text-xs text-muted-foreground">
                {t("emailInbox.detail.attachmentDismissed")}
              </span>
            ) : (
              <div className="ml-auto flex gap-2">
                <Button
                  size="sm"
                  disabled={!defaultProcedureId || documentType === "" || save.isPending}
                  onClick={() => save.mutate(attachment.id)}
                >
                  {t("emailInbox.detail.attachmentSave")}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => dismiss.mutate(attachment.id)}>
                  {t("emailInbox.detail.attachmentDismiss")}
                </Button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
