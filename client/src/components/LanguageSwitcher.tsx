import { useTranslation } from "react-i18next";

export function LanguageSwitcher() {
  const { i18n } = useTranslation();

  const setLang = (lng: "tr" | "en") => {
    i18n.changeLanguage(lng);
    localStorage.setItem("appLang", lng);
  };

  const current = i18n.language?.startsWith("tr") ? "tr" : "en";

  const cls = (active: boolean) =>
    `px-2 py-0.5 text-sm rounded ${
      active
        ? "bg-primary text-primary-foreground font-medium"
        : "text-muted-foreground hover:text-foreground"
    }`;

  return (
    <div className="fixed top-2 right-2 z-50 flex items-center gap-1 rounded-md border bg-background/80 backdrop-blur-sm px-1 py-0.5 shadow-sm">
      <button type="button" onClick={() => setLang("tr")} className={cls(current === "tr")}>
        TR
      </button>
      <span className="text-muted-foreground text-xs">|</span>
      <button type="button" onClick={() => setLang("en")} className={cls(current === "en")}>
        EN
      </button>
    </div>
  );
}
