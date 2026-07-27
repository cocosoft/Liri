import React from "react";
import { useTranslation } from "react-i18next";
import { ConfigSection, ConfigItem, ToggleConfig } from "./ConfigComponents";

interface AppearancePanelProps {
  isDark: boolean;
  config: Record<string, unknown>;
  setConfig: (key: string, value: unknown) => void;
  toggleTheme: () => void;
  /** 是否可为折叠面板 */
  collapsible?: boolean;
}

/** 时区选项 */
const TIMEZONE_OPTIONS = [
  { value: "Asia/Shanghai", label: "Asia/Shanghai (UTC+8)" },
  { value: "Asia/Tokyo", label: "Asia/Tokyo (UTC+9)" },
  { value: "America/New_York", label: "America/New_York (UTC-5)" },
  { value: "America/Los_Angeles", label: "America/Los_Angeles (UTC-8)" },
  { value: "Europe/London", label: "Europe/London (UTC+0)" },
  { value: "Europe/Berlin", label: "Europe/Berlin (UTC+1)" },
  { value: "Pacific/Auckland", label: "Pacific/Auckland (UTC+12)" },
  { value: "UTC", label: "UTC" },
];

/** 外观设置面板 — 从 SettingsPage.tsx 内联内容提取 */
function AppearancePanel({
  isDark,
  config,
  setConfig,
  toggleTheme,
  collapsible,
}: AppearancePanelProps) {
  const { t, i18n } = useTranslation();

  const language = (config.language as string) || navigator.language || "zh-CN";
  const timezone =
    (config.timezone as string) ||
    Intl.DateTimeFormat().resolvedOptions().timeZone ||
    "Asia/Shanghai";

  const SUPPORTED_LANGUAGES = [
    { value: "zh-CN", label: "简体中文" },
    { value: "en-US", label: "English (US)" },
  ];

  const PLANNED_LANGUAGES = [
    { value: "zh-TW", label: "繁體中文 (即將支援)" },
    { value: "en-GB", label: "English (UK) (coming soon)" },
    { value: "ja-JP", label: "日本語 (coming soon)" },
    { value: "ko-KR", label: "한국어 (coming soon)" },
    { value: "fr-FR", label: "Français (à venir)" },
    { value: "de-DE", label: "Deutsch (demnächst)" },
    { value: "es-ES", label: "Español (próximamente)" },
    { value: "pt-BR", label: "Português (BR) (em breve)" },
    { value: "ru-RU", label: "Русский (скоро)" },
    { value: "ar-SA", label: "العربية (قريباً)" },
  ];

  const handleLanguageChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const lang = e.target.value;
    setConfig("language", lang);
    const i18nLang = lang.startsWith("zh")
      ? "zh"
      : lang.startsWith("en")
        ? "en"
        : "zh";
    i18n.changeLanguage(i18nLang);
  };

  const currentThemeLabel = isDark ? t("settings.dark") : t("settings.light");

  return (
    <ConfigSection
      title={t("settings.appearance")}
      description={t("settings.appearanceDesc")}
      isDark={isDark}
      collapsible={collapsible}
    >
      <ConfigItem
        label={t("settings.theme")}
        description={`${t("settings.current")}: ${currentThemeLabel}`}
        isDark={isDark}
      >
        <ToggleConfig isDark={isDark} checked={isDark} onChange={toggleTheme} />
      </ConfigItem>
      <ConfigItem label={t("settings.language")} isDark={isDark}>
        <select
          value={language}
          onChange={handleLanguageChange}
          className="w-full max-w-sm px-3 py-1.5 text-sm border rounded bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-100"
        >
          <optgroup label="---">
            {SUPPORTED_LANGUAGES.map((l) => (
              <option key={l.value} value={l.value}>
                {l.label}
              </option>
            ))}
          </optgroup>
          <optgroup label={t("settings.comingSoon")}>
            {PLANNED_LANGUAGES.map((l) => (
              <option key={l.value} value={l.value} disabled>
                {l.label}
              </option>
            ))}
          </optgroup>
        </select>
      </ConfigItem>
      <ConfigItem label={t("settings.timezone")} isDark={isDark}>
        <select
          value={timezone}
          onChange={(e) => setConfig("timezone", e.target.value)}
          className="w-full max-w-sm px-3 py-1.5 text-sm border rounded bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-100"
        >
          {TIMEZONE_OPTIONS.map((tz) => (
            <option key={tz.value} value={tz.value}>
              {tz.label}
            </option>
          ))}
        </select>
      </ConfigItem>
    </ConfigSection>
  );
}

export default AppearancePanel;
