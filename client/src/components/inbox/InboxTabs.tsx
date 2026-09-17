import { useTranslation } from "react-i18next";
import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { apiRequest } from "@/lib/queryClient";
import type { OtherMailsResponse } from "./types";

const TABS = [
  { url: "/inbox", labelKey: "emailInbox.tabs.mails" },
  { url: "/procedure-mails", labelKey: "emailInbox.tabs.procedures" },
  { url: "/other-mails", labelKey: "emailInbox.tabs.other" },
];

/**
 * Mail Takibi'nin iki görünümü arasındaki geçiş. Sol menüyü kalabalıklaştırmamak
 * için sayfanın üstünde duruyor; her görünümün kendi adresi var, böylece
 * yer imi ve geri tuşu çalışmaya devam ediyor.
 */
export function InboxTabs() {
  const { t } = useTranslation();
  const [location] = useLocation();

  // "Diğer" kutusunda bekleyen iş sayısı sekmenin yanında görünür; gözden
  // kaçmasın diye sekmeye girmeden de belli oluyor.
  const other = useQuery<OtherMailsResponse>({
    queryKey: ["/api/email/other"],
    queryFn: async () => (await apiRequest("GET", "/api/email/other")).json(),
    staleTime: 60_000,
  });
  const openCount = other.data?.openCount ?? 0;

  return (
    <nav className="flex gap-1 border-b" aria-label={t("nav.emailInbox")}>
      {TABS.map((tab) => {
        const active = location === tab.url;
        return (
          <Link
            key={tab.url}
            href={tab.url}
            className={cn(
              "-mb-px border-b-2 px-4 py-2 text-sm transition-colors",
              active
                ? "border-primary font-medium text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
            aria-current={active ? "page" : undefined}
          >
            {t(tab.labelKey)}
            {tab.url === "/other-mails" && openCount > 0 && (
              <Badge className="ml-2" variant="secondary">
                {openCount}
              </Badge>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
