import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import zh from "./locales/zh";
import en from "./locales/en";

const resources = {
  zh: { translation: zh },
  en: { translation: en },
};

/** 从 localStorage 读取用户保存的语言偏好 */
function getSavedLanguage(): string {
  try {
    const stored = localStorage.getItem("liri-config");
    if (stored) {
      const parsed = JSON.parse(stored);
      const lang = parsed?.state?.config?.language as string | undefined;
      if (lang) {
        return lang.startsWith("zh")
          ? "zh"
          : lang.startsWith("en")
            ? "en"
            : "zh";
      }
    }
  } catch {}
  return "zh";
}

i18n.use(initReactI18next).init({
  resources,
  lng: getSavedLanguage(),
  fallbackLng: "zh",
  interpolation: {
    escapeValue: false,
  },
});

/** i18n 语言码（zh/en）→ 文档语言标签（zh-CN/en-US） */
function toDocumentLang(lng: string): string {
  return lng.startsWith("en") ? "en-US" : "zh-CN";
}

/** 2026-11-21：html[lang] 必须跟随界面语言（此前恒为 zh-CN，屏幕阅读器/翻译工具会误判） */
i18n.on("languageChanged", (lng) => {
  document.documentElement.lang = toDocumentLang(lng);
});
document.documentElement.lang = toDocumentLang(i18n.language || "zh");

export default i18n;
