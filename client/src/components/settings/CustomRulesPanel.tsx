import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import {
  ConfigSection,
  ConfigItem,
  TextConfig,
  SelectConfig,
} from "./ConfigComponents";
import { httpLegacy as http } from "../../services/httpClient";

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

/** 权限配置 */
interface PermissionConfig {
  customRules?: CustomRulesConfig;
}

interface CustomRulesPanelProps {
  isDark: boolean;
}

type RuleTab = "command-blacklist" | "command-whitelist" | "dir-blacklist" | "dir-whitelist";

const RULE_TABS: { id: RuleTab; label: string }[] = [
  { id: "command-blacklist", label: "命令黑名单" },
  { id: "command-whitelist", label: "命令白名单" },
  { id: "dir-blacklist", label: "目录黑名单" },
  { id: "dir-whitelist", label: "目录白名单" },
];

function CustomRulesPanel({ isDark }: CustomRulesPanelProps) {
  const { t } = useTranslation();
  const [config, setConfig] = useState<CustomRulesConfig>({});
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<RuleTab>("command-blacklist");
  const [newItem, setNewItem] = useState("");

  /** 加载配置 */
  const loadConfig = async () => {
    try {
      const res = await http.get<{ key: string; value: PermissionConfig }>(
        "/v1/config/permission"
      );
      if (res?.value?.customRules) {
        setConfig(res.value.customRules);
      } else {
        // P1修复：初始化默认空结构，避免页面"全空"
        setConfig({
          commandRules: { mode: "blacklist", whitelist: [], blacklist: [] },
          directoryRules: { whitelist: [], blacklist: [] },
        });
      }
    } catch {
      setError("加载自定义规则失败");
    }
  };

  /** 保存配置 */
  const saveConfig = async () => {
    setLoading(true);
    setSaved(false);
    setError(null);
    try {
      const res = await http.get<{ key: string; value: PermissionConfig }>(
        "/v1/config/permission"
      );
      const existing = res?.value || {};
      await http.put("/v1/config/permission", {
        value: { ...existing, customRules: config },
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch {
      setError("保存失败");
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
      return "输入命令模式（如 rm -rf, chmod）";
    }
    return "输入目录路径（如 /etc, C:\\Windows）";
  };

  // 首次渲染时加载配置
  useEffect(() => {
    loadConfig();
  }, []);

  return (
    <ConfigSection
      title={t("settings.customRules")}
      description={t("settings.customRulesDesc")}
      isDark={isDark}
    >
      {/* 命令模式选择 */}
      <ConfigItem label="命令模式" isDark={isDark}>
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
            { value: "blacklist", label: "黑名单模式（默认放行）" },
            { value: "whitelist", label: "白名单模式（仅允许）" },
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
            {tab.label}
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
          添加
        </button>
      </div>

      {/* 规则列表 */}
      {getCurrentList().length === 0 ? (
        <div className={`py-3 px-3 rounded-lg text-xs space-y-1.5 ${isDark ? "bg-gray-800/50 text-gray-400" : "bg-gray-50 text-gray-500"}`}>
          <p className="font-medium">暂无{activeTab.includes("command") ? "命令" : "目录"}规则</p>
          {activeTab === "command-blacklist" && (
            <p>添加命令模式（如 <code className="px-1 py-0.5 rounded bg-gray-200 dark:bg-gray-700">rm -rf</code>）后，匹配的命令将被拦截。</p>
          )}
          {activeTab === "command-whitelist" && (
            <p>添加命令模式后，仅允许匹配的命令执行，其余全部拦截。</p>
          )}
          {activeTab === "dir-blacklist" && (
            <p>添加目录路径（如 <code className="px-1 py-0.5 rounded bg-gray-200 dark:bg-gray-700">/etc</code>）后，禁止访问该目录。</p>
          )}
          {activeTab === "dir-whitelist" && (
            <p>添加目录路径后，仅允许访问这些目录，其余全部拦截。</p>
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
          {loading ? "保存中..." : "保存配置"}
        </button>
        {saved && (
          <span className="text-xs text-green-500">已保存</span>
        )}
        {error && (
          <span className="text-xs text-red-500">{error}</span>
        )}
      </div>
    </ConfigSection>
  );
}

export default CustomRulesPanel;
