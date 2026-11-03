import { useTranslation } from "react-i18next";

import { ConfigSection } from "./ConfigComponents";

/**
 * 自主执行（AlwaysOn）运行预算（2026-11-03 P0）
 *
 * 背景：原先 20 分钟 / 4 轮 / 60 分钟间隔是硬编码，长程任务跑不到可见进度就被停。
 * 现改为可调（写入 `autonomy.limits`，后端订阅 `config:changed` 后按新预算重建调度）。
 */
export interface AutonomyLimitsValue {
  timeoutMinutes: number;
  maxToolCalls: number;
  dailyBudget: number;
  cooldownMinutes: number;
}

interface AutonomyLimitsPanelProps {
  isDark: boolean;
  collapsible?: boolean;
  limits: AutonomyLimitsValue;
  onUpdate: (patch: Partial<AutonomyLimitsValue>) => void;
}

const FIELDS: Array<{
  key: keyof AutonomyLimitsValue;
  labelKey: string;
  min: number;
  max: number;
}> = [
  {
    key: "timeoutMinutes",
    labelKey: "settings.autonomyTimeoutMinutes",
    min: 1,
    max: 180,
  },
  {
    key: "maxToolCalls",
    labelKey: "settings.autonomyMaxToolCalls",
    min: 10,
    max: 2000,
  },
  { key: "dailyBudget", labelKey: "settings.autonomyDailyBudget", min: 1, max: 48 },
  {
    key: "cooldownMinutes",
    labelKey: "settings.autonomyCooldownMinutes",
    min: 1,
    max: 1440,
  },
];

export default function AutonomyLimitsPanel({
  isDark,
  collapsible,
  limits,
  onUpdate,
}: AutonomyLimitsPanelProps) {
  const { t } = useTranslation();

  return (
    <ConfigSection
      title={t("settings.autonomyLimitsTitle")}
      description={t("settings.autonomyLimitsDesc")}
      isDark={isDark}
      collapsible={collapsible}
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {FIELDS.map((field) => (
          <label
            key={field.key}
            className="flex items-center justify-between gap-2"
          >
            <span className="text-sm text-gray-700 dark:text-gray-300">
              {t(field.labelKey)}
            </span>
            <input
              type="number"
              min={field.min}
              max={field.max}
              value={limits[field.key]}
              onChange={(e) => {
                const next = Number(e.target.value);
                if (!Number.isFinite(next)) return;
                onUpdate({ [field.key]: next });
              }}
              className={`w-24 px-2 py-1 text-sm rounded border ${
                isDark
                  ? "bg-gray-800 border-gray-700 text-gray-100"
                  : "bg-white border-gray-300 text-gray-800"
              }`}
            />
          </label>
        ))}
      </div>
      <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
        {t("settings.autonomyLimitsHint")}
      </p>
    </ConfigSection>
  );
}
