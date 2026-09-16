import { useTranslation } from "react-i18next";
import { Link, useLocation } from "wouter";
import { cn } from "@/lib/utils";

const TABS = [
  { url: "/inbox", labelKey: "emailInbox.tabs.mails" },
  { url: "/procedure-mails", labelKey: "emailInbox.tabs.procedures" },
];

/**
 * Mail Takibi'nin iki görünümü arasındaki geçiş. Sol menüyü kalabalıklaştırmamak
 * için sayfanın üstünde duruyor; her görünümün kendi adresi var, böylece
 * yer imi ve geri tuşu çalışmaya devam ediyor.
 */
export function InboxTabs() {
  const { t } = useTranslation();
  const [location] = useLocation();

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
          </Link>
        );
      })}
    </nav>
  );
}
