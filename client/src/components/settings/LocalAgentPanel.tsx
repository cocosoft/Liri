import { useTranslation } from "react-i18next";
import {
  ConfigSection,
  ConfigItem,
  SelectConfig,
  ToggleConfig,
} from "./ConfigComponents";

/** Ollama 默认端点（与 config/providerPresets.ts 中 PRESETS 对齐） */
const OLLAMA_ENDPOINTS = [
  { value: "http://localhost:11434", label: "localhost:11434" },
  { value: "http://127.0.0.1:11434", label: "127.0.0.1:11434" },
];

interface RoutingConfig {
  strategy: "cloud-first" | "ollama-first" | "local-first";
  fallbackToCloud: boolean;
}

interface LocalAgentConfig {
  enabled: boolean;
  routing: RoutingConfig;
  bypassRoutes?: string[];
  enableMetrics?: boolean;
}

interface OllamaConfig {
  enabled: boolean;
  baseUrl: string;
  defaultModel: string;
  timeout: number;
}

interface LocalAgentPanelProps {
  isDark: boolean;
  localAgent: LocalAgentConfig;
  ollama?: OllamaConfig;
  onUpdateLocalAgent: (updates: Partial<LocalAgentConfig>) => void;
  onUpdateOllama: (updates: Partial<OllamaConfig>) => void;
  collapsible?: boolean;
}

function LocalAgentPanel({
  isDark,
  localAgent,
  ollama,
  onUpdateLocalAgent,
  onUpdateOllama,
  collapsible,
}: LocalAgentPanelProps) {
  const { t } = useTranslation();

  return (
    <ConfigSection
      title={t("settings.localAgent")}
      description={t("settings.localAgentDesc")}
      isDark={isDark}
      collapsible={collapsible}
    >
      <div className="space-y-4">
        <ConfigItem label={t("settings.localAgentEnable")} isDark={isDark}>
          <ToggleConfig
            isDark={isDark}
            checked={localAgent.enabled}
            onChange={(checked) => onUpdateLocalAgent({ enabled: checked })}
          />
        </ConfigItem>

        {localAgent.enabled && (
          <>
            <div className={`h-px ${isDark ? "bg-gray-700" : "bg-gray-200"}`} />

            <ConfigItem
              label={t("settings.localAgentRoutingStrategy")}
              isDark={isDark}
            >
              <SelectConfig
                isDark={isDark}
                value={localAgent.routing.strategy}
                onChange={(value) =>
                  onUpdateLocalAgent({
                    routing: {
                      ...localAgent.routing,
                      strategy: value as RoutingConfig["strategy"],
                    },
                  })
                }
                options={[
                  {
                    value: "cloud-first",
                    label: t("settings.localAgentRoutingCloudFirst"),
                  },
                  {
                    value: "ollama-first",
                    label: t("settings.localAgentRoutingOllamaFirst"),
                  },
                  {
                    value: "local-first",
                    label: t("settings.localAgentRoutingLocalFirst"),
                  },
                ]}
              />
            </ConfigItem>

            <ConfigItem
              label={t("settings.localAgentFallbackToCloud")}
              description={t("settings.localAgentFallbackToCloudDesc")}
              isDark={isDark}
            >
              <ToggleConfig
                isDark={isDark}
                checked={localAgent.routing.fallbackToCloud}
                onChange={(checked) =>
                  onUpdateLocalAgent({
                    routing: {
                      ...localAgent.routing,
                      fallbackToCloud: checked,
                    },
                  })
                }
              />
            </ConfigItem>

            <ConfigItem
              label={t("settings.localAgentEnableMetrics")}
              description={t("settings.localAgentEnableMetricsDesc")}
              isDark={isDark}
            >
              <ToggleConfig
                isDark={isDark}
                checked={localAgent.enableMetrics || false}
                onChange={(checked) =>
                  onUpdateLocalAgent({ enableMetrics: checked })
                }
              />
            </ConfigItem>

            {localAgent.bypassRoutes && localAgent.bypassRoutes.length > 0 && (
              <div className="mt-2">
                <div
                  className={`text-xs font-medium mb-1 ${isDark ? "text-gray-400" : "text-gray-500"}`}
                >
                  {t("settings.localAgentBypassRoutes")}
                </div>
                <div className="flex flex-wrap gap-1">
                  {localAgent.bypassRoutes.map((route, i) => (
                    <span
                      key={i}
                      className={`px-2 py-0.5 text-xs rounded ${
                        isDark
                          ? "bg-gray-700 text-gray-300"
                          : "bg-gray-100 text-gray-600"
                      }`}
                    >
                      {route}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        <div className={`h-px ${isDark ? "bg-gray-700" : "bg-gray-200"}`} />

        <div
          className={`text-sm font-medium mb-2 ${isDark ? "text-gray-200" : "text-gray-700"}`}
        >
          {t("settings.localAgentOllamaTitle")}
        </div>

        <ConfigItem
          label={t("settings.localAgentOllamaEnabled")}
          isDark={isDark}
        >
          <ToggleConfig
            isDark={isDark}
            checked={ollama?.enabled || false}
            onChange={(checked) => onUpdateOllama({ enabled: checked })}
          />
        </ConfigItem>

        {ollama?.enabled && (
          <>
            <ConfigItem
              label={t("settings.localAgentOllamaBaseUrl")}
              isDark={isDark}
            >
              <SelectConfig
                isDark={isDark}
                value={ollama.baseUrl}
                onChange={(value) => onUpdateOllama({ baseUrl: value })}
                options={OLLAMA_ENDPOINTS}
              />
            </ConfigItem>

            <ConfigItem label={t("settings.defaultModel")} isDark={isDark}>
              <SelectConfig
                isDark={isDark}
                value={ollama.defaultModel}
                onChange={(value) => onUpdateOllama({ defaultModel: value })}
                options={[
                  { value: "llama3", label: "llama3" },
                  { value: "llama3.1", label: "llama3.1" },
                  { value: "mistral", label: "mistral" },
                  { value: "codellama", label: "codellama" },
                  { value: "phi3", label: "phi3" },
                ]}
              />
            </ConfigItem>

            <ConfigItem
              label={t("settings.localAgentOllamaTimeout")}
              isDark={isDark}
            >
              <SelectConfig
                isDark={isDark}
                value={String(ollama.timeout)}
                onChange={(value) =>
                  onUpdateOllama({ timeout: parseInt(value, 10) })
                }
                options={[
                  { value: "30000", label: t("settings.localAgentTimeout30s") },
                  { value: "60000", label: t("settings.localAgentTimeout60s") },
                  {
                    value: "120000",
                    label: t("settings.localAgentTimeout120s"),
                  },
                  {
                    value: "300000",
                    label: t("settings.localAgentTimeout300s"),
                  },
                ]}
              />
            </ConfigItem>
          </>
        )}
      </div>
    </ConfigSection>
  );
}

export default LocalAgentPanel;
