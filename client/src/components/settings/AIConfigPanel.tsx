import { useTranslation } from "react-i18next";
import {
  ConfigSection,
  ConfigItem,
  TextConfig,
  SelectConfig,
} from "./ConfigComponents";

interface AIConfigProps {
  isDark: boolean;
  config: {
    provider?: string;
    model?: string;
    deepseek?: { apiKey?: string; baseUrl?: string; model?: string };
    anthropic?: { apiKey?: string; baseUrl?: string; model?: string };
    openai?: { apiKey?: string; baseUrl?: string; model?: string };
  };
  onUpdate: (updates: Partial<AIConfigProps["config"]>) => void;
  collapsible?: boolean;
}

function AIConfigPanel({
  isDark,
  config,
  onUpdate,
  collapsible,
}: AIConfigProps) {
  const { t } = useTranslation();

  const handleProviderChange = (provider: string) => {
    onUpdate({ provider });
  };

  const handleDeepseekChange = (field: string, value: string) => {
    onUpdate({
      deepseek: { ...config.deepseek, [field]: value },
    });
  };

  const handleAnthropicChange = (field: string, value: string) => {
    onUpdate({
      anthropic: { ...config.anthropic, [field]: value },
    });
  };

  const handleOpenaiChange = (field: string, value: string) => {
    onUpdate({
      openai: { ...config.openai, [field]: value },
    });
  };

  return (
    <ConfigSection
      title={t("settings.aiConfig")}
      description={t("settings.aiConfigDesc")}
      isDark={isDark}
      collapsible={collapsible}
    >
      <div className="space-y-4">
        <ConfigItem label={t("settings.providers")} isDark={isDark}>
          <SelectConfig
            isDark={isDark}
            value={config.provider || "openai"}
            onChange={handleProviderChange}
            options={[
              { value: "openai", label: "OpenAI" },
              { value: "anthropic", label: "Anthropic" },
              { value: "deepseek", label: "DeepSeek" },
              { value: "ollama", label: t("settings.providersOllama") },
              { value: "azure", label: "Azure" },
            ]}
          />
        </ConfigItem>

        <ConfigItem label={t("settings.defaultModel")} isDark={isDark}>
          <TextConfig
            isDark={isDark}
            value={config.model || ""}
            onChange={(value) => onUpdate({ model: value })}
            placeholder={t("settings.defaultModelPlaceholder")}
          />
        </ConfigItem>

        {(config.provider === "deepseek" || !config.provider) && (
          <div
            className={`p-3 rounded border ${isDark ? "border-gray-700 bg-gray-700/30" : "border-gray-200 bg-gray-50"}`}
          >
            <h4
              className={`text-sm font-medium mb-3 ${isDark ? "text-gray-200" : "text-gray-700"}`}
            >
              {t("settings.aiConfigDeepseekTitle")}
            </h4>
            <div className="space-y-3">
              <ConfigItem label={t("settings.apiKey")} isDark={isDark}>
                <TextConfig
                  isDark={isDark}
                  type="password"
                  value={config.deepseek?.apiKey || ""}
                  onChange={(v) => handleDeepseekChange("apiKey", v)}
                  placeholder="sk-..."
                />
              </ConfigItem>
              <ConfigItem label={t("settings.apiEndpoint")} isDark={isDark}>
                <TextConfig
                  isDark={isDark}
                  value={config.deepseek?.baseUrl || ""}
                  onChange={(v) => handleDeepseekChange("baseUrl", v)}
                  placeholder="https://api.deepseek.com"
                />
              </ConfigItem>
              <ConfigItem label={t("settings.models")} isDark={isDark}>
                <TextConfig
                  isDark={isDark}
                  value={config.deepseek?.model || ""}
                  onChange={(v) => handleDeepseekChange("model", v)}
                  placeholder="deepseek-v4-pro"
                />
              </ConfigItem>
            </div>
          </div>
        )}

        {config.provider === "anthropic" && (
          <div
            className={`p-3 rounded border ${isDark ? "border-gray-700 bg-gray-700/30" : "border-gray-200 bg-gray-50"}`}
          >
            <h4
              className={`text-sm font-medium mb-3 ${isDark ? "text-gray-200" : "text-gray-700"}`}
            >
              {t("settings.aiConfigAnthropicTitle")}
            </h4>
            <div className="space-y-3">
              <ConfigItem label={t("settings.apiKey")} isDark={isDark}>
                <TextConfig
                  isDark={isDark}
                  type="password"
                  value={config.anthropic?.apiKey || ""}
                  onChange={(v) => handleAnthropicChange("apiKey", v)}
                  placeholder="sk-ant-..."
                />
              </ConfigItem>
              <ConfigItem label={t("settings.apiEndpoint")} isDark={isDark}>
                <TextConfig
                  isDark={isDark}
                  value={config.anthropic?.baseUrl || ""}
                  onChange={(v) => handleAnthropicChange("baseUrl", v)}
                  placeholder="https://api.anthropic.com"
                />
              </ConfigItem>
              <ConfigItem label={t("settings.models")} isDark={isDark}>
                <TextConfig
                  isDark={isDark}
                  value={config.anthropic?.model || ""}
                  onChange={(v) => handleAnthropicChange("model", v)}
                  placeholder="claude-3-opus"
                />
              </ConfigItem>
            </div>
          </div>
        )}

        {config.provider === "openai" && (
          <div
            className={`p-3 rounded border ${isDark ? "border-gray-700 bg-gray-700/30" : "border-gray-200 bg-gray-50"}`}
          >
            <h4
              className={`text-sm font-medium mb-3 ${isDark ? "text-gray-200" : "text-gray-700"}`}
            >
              {t("settings.aiConfigOpenaiTitle")}
            </h4>
            <div className="space-y-3">
              <ConfigItem label={t("settings.apiKey")} isDark={isDark}>
                <TextConfig
                  isDark={isDark}
                  type="password"
                  value={config.openai?.apiKey || ""}
                  onChange={(v) => handleOpenaiChange("apiKey", v)}
                  placeholder="sk-..."
                />
              </ConfigItem>
              <ConfigItem label={t("settings.apiEndpoint")} isDark={isDark}>
                <TextConfig
                  isDark={isDark}
                  value={config.openai?.baseUrl || ""}
                  onChange={(v) => handleOpenaiChange("baseUrl", v)}
                  placeholder="https://api.openai.com"
                />
              </ConfigItem>
              <ConfigItem label={t("settings.models")} isDark={isDark}>
                <TextConfig
                  isDark={isDark}
                  value={config.openai?.model || ""}
                  onChange={(v) => handleOpenaiChange("model", v)}
                  placeholder="gpt-4o"
                />
              </ConfigItem>
            </div>
          </div>
        )}
      </div>
    </ConfigSection>
  );
}

export default AIConfigPanel;
