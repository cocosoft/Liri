import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import {
  ConfigSection,
  ConfigItem,
  TextConfig,
  SelectConfig,
} from "./ConfigComponents";
import { httpLegacy as http } from "../../services/httpClient";
import { handleClientError } from "../../utils/handleError";
import SafetyPositionBanner from "./SafetyPositionBanner";

/** 命令规则 */
interface CommandRule {
  pattern: string;
  label?: string;
}

/** 目录规则 */
interface DirectoryRule {
  path: string;
  recursive?: boolean;
}

/** 自定义规则 */
interface CustomRulesConfig {
  commandRules?: {
    whitelist?: CommandRule[];
    blacklist?: CommandRule[];
    mode?: "whitelist" | "blacklist";
  };
  directoryRules?: {
    whitelist?: DirectoryRule[];
    blacklist?: DirectoryRule[];
  };
}

/** 权限配置（整块存储，保留 mode/trustedWorkspaces 避免覆盖信任工作区面板数据） */
interface PermissionConfig {
  mode?: "default" | "strict" | "permissive";
  trustedWorkspaces?: unknown[];
  customRules?: CustomRulesConfig;
}

interface CustomRulesPanelProps {
  isDark: boolean;
}

type RuleTab =
  "command-blacklist" | "command-whitelist" | "dir-blacklist" | "dir-whitelist";

const RULE_TABS: { id: RuleTab; labelKey: string }[] = [
  { id: "command-blacklist", labelKey: "settings.rulesTabCommandBlacklist" },
  { id: "command-whitelist", labelKey: "settings.rulesTabCommandWhitelist" },
  { id: "dir-blacklist", labelKey: "settings.rulesTabDirBlacklist" },
  { id: "dir-whitelist", labelKey: "settings.rulesTabDirWhitelist" },
];

function CustomRulesPanel({ isDark }: CustomRulesPanelProps) {
  const { t } = useTranslation();
  const [config, setConfig] = useState<CustomRulesConfig>({});
  const [permission, setPermission] = useState<PermissionConfig>({});
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<RuleTab>("command-blacklist");
  const [newItem, setNewItem] = useState("");

  /** 加载配置 */
  const loadConfig = async () => {
    try {
      const res = await http.get<{ key: string; value: PermissionConfig }>(
        "/v1/config/permission",
      );
      setPermission(res?.value ?? {});
      if (res?.value?.customRules) {
        setConfig(res.value.customRules);
      } else {
        // P1修复：初始化默认空结构，避免页面"全空"
        setConfig({
          commandRules: { mode: "blacklist", whitelist: [], blacklist: [] },
          directoryRules: { whitelist: [], blacklist: [] },
        });
      }
    } catch (e) {
      handleClientError(e, {
        module: "components:settings:CustomRules",
        action: "loadConfig",
      });
      setError(t("settings.rulesLoadFailed"));
    }
  };

  /** 保存配置（整块，保留 mode/trustedWorkspaces） */
  const saveConfig = async () => {
    setLoading(true);
    setSaved(false);
    setError(null);
    try {
      await http.put("/v1/config/permission", {
        value: { ...permission, customRules: config },
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (e) {
      handleClientError(e, {
        module: "components:settings:CustomRules",
        action: "saveConfig",
      });
      setError(t("settings.rulesSaveFailed"));
    } finally {
      setLoading(false);
    }
  };

  /** 添加规则项 */
  const addItem = () => {
    const trimmed = newItem.trim();
    if (!trimmed) return;
    setConfig((prev) => {
      const next = { ...prev };
      if (activeTab === "command-blacklist") {
        const list = next.commandRules?.blacklist || [];
        if (list.some((r) => r.pattern === trimmed)) return prev;
        next.commandRules = {
          ...next.commandRules,
          blacklist: [...list, { pattern: trimmed }],
        };
      } else if (activeTab === "command-whitelist") {
        const list = next.commandRules?.whitelist || [];
        if (list.some((r) => r.pattern === trimmed)) return prev;
        next.commandRules = {
          ...next.commandRules,
          whitelist: [...list, { pattern: trimmed }],
        };
      } else if (activeTab === "dir-blacklist") {
        const list = next.directoryRules?.blacklist || [];
        if (list.some((r) => r.path === trimmed)) return prev;
        next.directoryRules = {
          ...next.directoryRules,
          blacklist: [...list, { path: trimmed }],
        };
      } else if (activeTab === "dir-whitelist") {
        const list = next.directoryRules?.whitelist || [];
        if (list.some((r) => r.path === trimmed)) return prev;
        next.directoryRules = {
          ...next.directoryRules,
          whitelist: [...list, { path: trimmed }],
        };
      }
      return next;
    });
    setNewItem("");
    setError(null);
  };

  /** 删除规则项 */
  const removeItem = (index: number) => {
    setConfig((prev) => {
      const next = { ...prev };
      if (activeTab === "command-blacklist") {
        const list = next.commandRules?.blacklist || [];
        next.commandRules = {
          ...next.commandRules,
          blacklist: list.filter((_, i) => i !== index),
        };
      } else if (activeTab === "command-whitelist") {
        const list = next.commandRules?.whitelist || [];
        next.commandRules = {
          ...next.commandRules,
          whitelist: list.filter((_, i) => i !== index),
        };
      } else if (activeTab === "dir-blacklist") {
        const list = next.directoryRules?.blacklist || [];
        next.directoryRules = {
          ...next.directoryRules,
          blacklist: list.filter((_, i) => i !== index),
        };
      } else if (activeTab === "dir-whitelist") {
        const list = next.directoryRules?.whitelist || [];
        next.directoryRules = {
          ...next.directoryRules,
          whitelist: list.filter((_, i) => i !== index),
        };
      }
      return next;
    });
  };

  /** 获取当前列表 */
  const getCurrentList = (): string[] => {
    if (activeTab === "command-blacklist") {
      return (config.commandRules?.blacklist || []).map((r) => r.pattern);
    }
    if (activeTab === "command-whitelist") {
      return (config.commandRules?.whitelist || []).map((r) => r.pattern);
    }
    if (activeTab === "dir-blacklist") {
      return (config.directoryRules?.blacklist || []).map((r) => r.path);
    }
    if (activeTab === "dir-whitelist") {
      return (config.directoryRules?.whitelist || []).map((r) => r.path);
    }
    return [];
  };

  /** 占位提示 */
  const getInputPlaceholder = (): string => {
    if (activeTab.startsWith("command")) {
      return t("settings.rulesCmdPlaceholder");
    }
    return t("settings.rulesDirPlaceholder");
  };

  // 首次渲染时加载配置
  useEffect(() => {
    loadConfig();
  }, []);

  return (
    <ConfigSection isDark={isDark}>
      {/* 安全定位横幅（M1） */}
      <SafetyPositionBanner
        layer={{ primary: "system" }}
        title={t("settings.customRules")}
        question={t("settings.rulesBannerQuestion")}
        relation={t("settings.rulesBannerRelation")}
        isDark={isDark}
      />
      {/* 命令模式选择 */}
      <ConfigItem label={t("settings.rulesCommandMode")} isDark={isDark}>
        <SelectConfig
          isDark={isDark}
          value={config.commandRules?.mode || "blacklist"}
          onChange={(value) =>
            setConfig({
              ...config,
              commandRules: {
                ...config.commandRules,
                mode: value as "whitelist" | "blacklist",
              },
            })
          }
          options={[
            { value: "blacklist", label: t("settings.rulesModeBlacklist") },
            { value: "whitelist", label: t("settings.rulesModeWhitelist") },
          ]}
        />
      </ConfigItem>

      {/* Tab 导航 */}
      <div className="flex gap-1 py-2">
        {RULE_TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-2.5 py-1 text-xs rounded transition-colors ${
              activeTab === tab.id
                ? "bg-blue-500 text-white"
                : isDark
                  ? "bg-gray-700 text-gray-300 hover:bg-gray-600"
                  : "bg-gray-200 text-gray-600 hover:bg-gray-300"
            }`}
          >
            {t(tab.labelKey)}
          </button>
        ))}
      </div>

      {/* 添加输入 */}
      <div className="flex items-center gap-2 py-2">
        <div className="flex-1">
          <TextConfig
            isDark={isDark}
            value={newItem}
            onChange={setNewItem}
            placeholder={getInputPlaceholder()}
          />
        </div>
        <button
          onClick={addItem}
          disabled={!newItem.trim()}
          className="px-3 py-1.5 text-sm bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {t("settings.rulesAdd")}
        </button>
      </div>

      {/* 规则列表 */}
      {getCurrentList().length === 0 ? (
        <div
          className={`py-3 px-3 rounded-lg text-xs space-y-1.5 ${isDark ? "bg-gray-800/50 text-gray-400" : "bg-gray-50 text-gray-500"}`}
        >
          <p className="font-medium">
            {t("settings.rulesEmpty", {
              type: t(
                activeTab.includes("command")
                  ? "settings.rulesEmptyCommand"
                  : "settings.rulesEmptyDir",
              ),
            })}
          </p>
          {activeTab === "command-blacklist" && (
            <p>
              {t("settings.rulesHintCmdBlacklistPrefix")}
              <code className="px-1 py-0.5 rounded bg-gray-200 dark:bg-gray-700">
                rm -rf
              </code>
              {t("settings.rulesHintCmdBlacklistSuffix")}
            </p>
          )}
          {activeTab === "command-whitelist" && (
            <p>{t("settings.rulesHintCmdWhitelist")}</p>
          )}
          {activeTab === "dir-blacklist" && (
            <p>
              {t("settings.rulesHintDirBlacklistPrefix")}
              <code className="px-1 py-0.5 rounded bg-gray-200 dark:bg-gray-700">
                /etc
              </code>
              {t("settings.rulesHintDirBlacklistSuffix")}
            </p>
          )}
          {activeTab === "dir-whitelist" && (
            <p>{t("settings.rulesHintDirWhitelist")}</p>
          )}
        </div>
      ) : (
        <div className="max-h-48 overflow-y-auto space-y-1">
          {getCurrentList().map((item, i) => (
            <div
              key={i}
              className={`flex items-center justify-between px-3 py-1.5 rounded text-sm ${
                isDark ? "bg-gray-700" : "bg-gray-50"
              }`}
            >
              <code className="text-xs break-all flex-1">{item}</code>
              <button
                onClick={() => removeItem(i)}
                className="text-red-400 hover:text-red-600 text-xs ml-2 shrink-0"
                aria-label={t("common.delete")}
              >
                {t("common.delete")}
              </button>
            </div>
          ))}
        </div>
      )}

      {/* 保存按钮 */}
      <div className="pt-3 flex items-center gap-3">
        <button
          onClick={saveConfig}
          disabled={loading}
          className="px-4 py-1.5 text-sm bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50"
        >
          {loading ? t("settings.saving") : t("settings.wsSaveConfig")}
        </button>
        {saved && (
          <span className="text-xs text-green-500">{t("settings.saved")}</span>
        )}
        {error && <span className="text-xs text-red-500">{error}</span>}
      </div>
    </ConfigSection>
  );
}

export default CustomRulesPanel;
