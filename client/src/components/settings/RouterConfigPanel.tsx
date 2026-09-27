/**
 * RouterConfigPanel — 智能路由配置面板
 *
 * A3：从 SettingsPage 提取共享组件，供 /settings 页面与侧边设置抽屉复用（CS01 归一化，禁止复制两份）。
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ConfigSection, ConfigItem, ToggleConfig } from "./ConfigComponents";
import { routerService } from "../../services/routerService";

/** 智能路由配置内容 */
function RouterConfigPanel({
  isDark,
  config,
  setConfig,
}: {
  isDark: boolean;
  config: Record<string, unknown>;
  setConfig: (key: string, value: unknown) => void;
}) {
  const { t } = useTranslation();
  const [routerExpanded, setRouterExpanded] = useState(false);

  const smartRouter = (config["models.router"] as {
    enabled: boolean;
    defaultTier: string;
    sessionSticky: boolean;
  }) || { enabled: true, defaultTier: "medium", sessionSticky: true };

  // 同步路由配置到后端运行时
  const syncRouterConfig = async (updated: typeof smartRouter) => {
    try {
      await routerService.updateConfig(updated);
    } catch {
      // 后端不可用时静默失败，配置仍保留在本地
    }
  };

  const handleToggleEnabled = (checked: boolean) => {
    const updated = { ...smartRouter, enabled: checked };
    setConfig("models.router", updated);
    syncRouterConfig(updated);
  };

  const handleChangeDefaultTier = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const updated = { ...smartRouter, defaultTier: e.target.value };
    setConfig("models.router", updated);
    syncRouterConfig(updated);
  };

  const handleToggleSticky = (checked: boolean) => {
    const updated = { ...smartRouter, sessionSticky: checked };
    setConfig("models.router", updated);
    syncRouterConfig(updated);
  };

  return (
    <div>
      <ConfigSection isDark={isDark}>
        <ConfigItem label={t("settings.routerEnable")} isDark={isDark}>
          <ToggleConfig
            isDark={isDark}
            checked={smartRouter.enabled}
            onChange={handleToggleEnabled}
          />
        </ConfigItem>
        {smartRouter.enabled && (
          <ConfigItem label={t("settings.routerDefaultTier")} isDark={isDark}>
            <select
              value={smartRouter.defaultTier}
              onChange={handleChangeDefaultTier}
              className="px-3 py-1.5 text-sm rounded-md border bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200"
            >
              <option value="simple">{t("settings.routerTierSimple")}</option>
              <option value="medium">{t("settings.routerTierMedium")}</option>
              <option value="complex">{t("settings.routerTierComplex")}</option>
              <option value="reasoning">
                {t("settings.routerTierReasoning")}
              </option>
            </select>
          </ConfigItem>
        )}
        {smartRouter.enabled && (
          <button
            onClick={() => setRouterExpanded(!routerExpanded)}
            className="text-xs text-blue-500 hover:text-blue-400 focus:outline-none ml-0.5"
          >
            {routerExpanded
              ? t("settings.routerCollapse")
              : t("settings.routerExpand")}
          </button>
        )}
        {smartRouter.enabled && routerExpanded && (
          <div className="space-y-2 mt-2 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-gray-500">
                {t("settings.routerSticky")}
              </span>
              <ToggleConfig
                isDark={isDark}
                checked={smartRouter.sessionSticky}
                onChange={handleToggleSticky}
              />
            </div>
            <div className="text-gray-400">
              {t("settings.routerJudgeModel")}{" "}
              <span className="text-gray-500">
                {t("settings.routerJudgeModelDesc")}
              </span>
            </div>
          </div>
        )}
      </ConfigSection>
    </div>
  );
}

export default RouterConfigPanel;
