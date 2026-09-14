import { useTranslation } from "react-i18next";
import { Paperclip } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { MessageListItem } from "./types";

interface Props {
  items: MessageListItem[];
  selectedId: number | null;
  onSelect: (id: number) => void;
}

export function EmailList({ items, selectedId, onSelect }: Props) {
  const { t, i18n } = useTranslation();

  if (items.length === 0) {
    return <p className="p-4 text-sm text-muted-foreground">{t("emailInbox.empty")}</p>;
  }

  return (
    <ul className="divide-y">
      {items.map((item) => (
        <li key={item.id}>
          <button
            type="button"
            onClick={() => onSelect(item.id)}
            className={cn(
              "w-full px-3 py-3 text-left hover:bg-muted/60",
              selectedId === item.id && "bg-muted",
            )}
          >
            <div className="flex items-start justify-between gap-2">
              <span className={cn("truncate text-sm", item.status === "new" && "font-semibold")}>
                {item.fromName || item.fromAddress}
              </span>
              <span className="shrink-0 text-xs text-muted-foreground">
                {item.sentAt ? new Date(item.sentAt).toLocaleDateString(i18n.language) : ""}
              </span>
            </div>

            <p className="truncate text-sm">{item.subject}</p>

            <div className="mt-1 flex flex-wrap items-center gap-1">
              {item.urgency === "high" && (
                <Badge variant="destructive">{t("emailInbox.urgency.high")}</Badge>
              )}
              {item.category && (
                <Badge variant="secondary">{t(`emailInbox.category.${item.category}`)}</Badge>
              )}
              {item.procedureReference ? (
                <Badge variant="outline">{item.procedureReference}</Badge>
              ) : (
                <Badge variant="outline">{t("emailInbox.unmatched")}</Badge>
              )}
              {item.aiStatus === "failed" && (
                <Badge variant="destructive">{t("emailInbox.aiFailed")}</Badge>
              )}
              {item.aiStatus === "pending" && (
                <Badge variant="secondary">{t("emailInbox.aiPending")}</Badge>
              )}
              {item.hasAttachments && <Paperclip className="h-3.5 w-3.5 text-muted-foreground" />}
            </div>
          </button>
        </li>
      ))}
    </ul>
  );
}
