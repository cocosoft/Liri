import { ConfigSection, ConfigItem, SelectConfig, ToggleConfig } from './ConfigComponents';

interface RoutingConfig {
  strategy: 'cloud-first' | 'ollama-first' | 'local-first';
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
}

function LocalAgentPanel({
  isDark,
  localAgent,
  ollama,
  onUpdateLocalAgent,
  onUpdateOllama,
}: LocalAgentPanelProps) {
  return (
    <ConfigSection
      title="本地 Agent 配置"
      description="配置本地 AI Agent 和路由策略"
      isDark={isDark}
    >
      <div className="space-y-4">
        <ConfigItem label="启用本地 Agent" isDark={isDark}>
          <ToggleConfig
            isDark={isDark}
            checked={localAgent.enabled}
            onChange={(checked) => onUpdateLocalAgent({ enabled: checked })}
          />
        </ConfigItem>

        {localAgent.enabled && (
          <>
            <div className={`h-px ${isDark ? 'bg-gray-700' : 'bg-gray-200'}`} />

            <ConfigItem label="路由策略" isDark={isDark}>
              <SelectConfig
                isDark={isDark}
                value={localAgent.routing.strategy}
                onChange={(value) =>
                  onUpdateLocalAgent({
                    routing: { ...localAgent.routing, strategy: value as RoutingConfig['strategy'] },
                  })
                }
                options={[
                  { value: 'cloud-first', label: '云端优先' },
                  { value: 'ollama-first', label: 'Ollama 优先' },
                  { value: 'local-first', label: '本地优先' },
                ]}
              />
            </ConfigItem>

            <ConfigItem label="降级到云端" description="本地模型不可用时自动切换到云端" isDark={isDark}>
              <ToggleConfig
                isDark={isDark}
                checked={localAgent.routing.fallbackToCloud}
                onChange={(checked) =>
                  onUpdateLocalAgent({
                    routing: { ...localAgent.routing, fallbackToCloud: checked },
                  })
                }
              />
            </ConfigItem>

            <ConfigItem label="性能指标" description="显示本地 Agent 性能统计" isDark={isDark}>
              <ToggleConfig
                isDark={isDark}
                checked={localAgent.enableMetrics || false}
                onChange={(checked) => onUpdateLocalAgent({ enableMetrics: checked })}
              />
            </ConfigItem>

            {localAgent.bypassRoutes && localAgent.bypassRoutes.length > 0 && (
              <div className="mt-2">
                <div className={`text-xs font-medium mb-1 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                  绕过路由（直接执行，不经过 LocalAgent）
                </div>
                <div className="flex flex-wrap gap-1">
                  {localAgent.bypassRoutes.map((route, i) => (
                    <span
                      key={i}
                      className={`px-2 py-0.5 text-xs rounded ${
                        isDark ? 'bg-gray-700 text-gray-300' : 'bg-gray-100 text-gray-600'
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

        <div className={`h-px ${isDark ? 'bg-gray-700' : 'bg-gray-200'}`} />

        <div className={`text-sm font-medium mb-2 ${isDark ? 'text-gray-200' : 'text-gray-700'}`}>
          Ollama 配置
        </div>

        <ConfigItem label="启用 Ollama" isDark={isDark}>
          <ToggleConfig
            isDark={isDark}
            checked={ollama?.enabled || false}
            onChange={(checked) => onUpdateOllama({ enabled: checked })}
          />
        </ConfigItem>

        {ollama?.enabled && (
          <>
            <ConfigItem label="服务地址" isDark={isDark}>
              <SelectConfig
                isDark={isDark}
                value={ollama.baseUrl}
                onChange={(value) => onUpdateOllama({ baseUrl: value })}
                options={[
                  { value: 'http://localhost:11434', label: 'localhost:11434' },
                  { value: 'http://127.0.0.1:11434', label: '127.0.0.1:11434' },
                ]}
              />
            </ConfigItem>

            <ConfigItem label="默认模型" isDark={isDark}>
              <SelectConfig
                isDark={isDark}
                value={ollama.defaultModel}
                onChange={(value) => onUpdateOllama({ defaultModel: value })}
                options={[
                  { value: 'llama3', label: 'llama3' },
                  { value: 'llama3.1', label: 'llama3.1' },
                  { value: 'mistral', label: 'mistral' },
                  { value: 'codellama', label: 'codellama' },
                  { value: 'phi3', label: 'phi3' },
                ]}
              />
            </ConfigItem>

            <ConfigItem label="超时时间 (ms)" isDark={isDark}>
              <SelectConfig
                isDark={isDark}
                value={String(ollama.timeout)}
                onChange={(value) => onUpdateOllama({ timeout: parseInt(value, 10) })}
                options={[
                  { value: '30000', label: '30秒' },
                  { value: '60000', label: '60秒' },
                  { value: '120000', label: '120秒' },
                  { value: '300000', label: '300秒' },
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