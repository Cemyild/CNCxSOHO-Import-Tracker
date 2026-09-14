import { useTranslation } from "react-i18next";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

export interface InboxFilterState {
  status: string;
  urgency: string;
  category: string;
  matched: string;
  q: string;
}

export const EMPTY_FILTERS: InboxFilterState = {
  status: "all", urgency: "all", category: "all", matched: "all", q: "",
};

interface Props {
  value: InboxFilterState;
  onChange: (next: InboxFilterState) => void;
}

export function InboxFilters({ value, onChange }: Props) {
  const { t } = useTranslation();
  const set = (patch: Partial<InboxFilterState>) => onChange({ ...value, ...patch });

  const dropdown = (
    key: keyof InboxFilterState,
    label: string,
    options: Array<{ value: string; label: string }>,
  ) => (
    <Select value={value[key]} onValueChange={(v) => set({ [key]: v } as Partial<InboxFilterState>)}>
      <SelectTrigger className="w-[150px]" aria-label={label}>
        <SelectValue placeholder={label} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">{t("emailInbox.filters.all")}</SelectItem>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Input
        className="w-[240px]"
        placeholder={t("emailInbox.filters.search")}
        value={value.q}
        onChange={(e) => set({ q: e.target.value })}
      />
      {dropdown("status", t("emailInbox.filters.status"), [
        { value: "new", label: t("emailInbox.status.new") },
        { value: "read", label: t("emailInbox.status.read") },
        { value: "done", label: t("emailInbox.status.done") },
      ])}
      {dropdown("urgency", t("emailInbox.filters.urgency"), [
        { value: "high", label: t("emailInbox.urgency.high") },
        { value: "normal", label: t("emailInbox.urgency.normal") },
        { value: "low", label: t("emailInbox.urgency.low") },
      ])}
      {dropdown("category", t("emailInbox.filters.category"), [
        { value: "payment", label: t("emailInbox.category.payment") },
        { value: "document", label: t("emailInbox.category.document") },
        { value: "customs", label: t("emailInbox.category.customs") },
        { value: "shipment", label: t("emailInbox.category.shipment") },
        { value: "other", label: t("emailInbox.category.other") },
      ])}
      {dropdown("matched", t("emailInbox.filters.matched"), [
        { value: "yes", label: t("emailInbox.filters.matchedYes") },
        { value: "no", label: t("emailInbox.filters.matchedNo") },
      ])}
      <Button variant="ghost" size="sm" onClick={() => onChange(EMPTY_FILTERS)}>
        {t("emailInbox.filters.clear")}
      </Button>
    </div>
  );
}
