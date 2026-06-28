import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "../locales/en.json";
import tr from "../locales/tr.json";

const saved = localStorage.getItem("appLang") || "en";

i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    tr: { translation: tr },
  },
  lng: saved,
  fallbackLng: "en",
  interpolation: { escapeValue: false },
});

export default i18n;
