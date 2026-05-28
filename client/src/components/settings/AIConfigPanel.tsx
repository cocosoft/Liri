import { ConfigSection, ConfigItem, TextConfig, SelectConfig } from './ConfigComponents';

interface AIConfigProps {
  isDark: boolean;
  config: {
    provider?: string;
    model?: string;
    deepseek?: { apiKey?: string; baseUrl?: string; model?: string };
    anthropic?: { apiKey?: string; baseUrl?: string; model?: string };
    openai?: { apiKey?: string; baseUrl?: string; model?: string };
  };
  onUpdate: (updates: Partial<AIConfigProps['config']>) => void;
}

function AIConfigPanel({ isDark, config, onUpdate }: AIConfigProps) {
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
      title="AI 配置"
      description="配置 AI 提供商和模型参数"
      isDark={isDark}
    >
      <div className="space-y-4">
        <ConfigItem label="AI 提供商" isDark={isDark}>
          <SelectConfig
            isDark={isDark}
            value={config.provider || 'openai'}
            onChange={handleProviderChange}
            options={[
              { value: 'openai', label: 'OpenAI' },
              { value: 'anthropic', label: 'Anthropic' },
              { value: 'deepseek', label: 'DeepSeek' },
              { value: 'ollama', label: 'Ollama (本地)' },
              { value: 'azure', label: 'Azure' },
            ]}
          />
        </ConfigItem>

        <ConfigItem label="默认模型" isDark={isDark}>
          <TextConfig
            isDark={isDark}
            value={config.model || ''}
            onChange={(value) => onUpdate({ model: value })}
            placeholder="例如: gpt-4o, claude-3-opus, deepseek-chat"
          />
        </ConfigItem>

        {(config.provider === 'deepseek' || !config.provider) && (
          <div className={`p-3 rounded border ${isDark ? 'border-gray-700 bg-gray-700/30' : 'border-gray-200 bg-gray-50'}`}>
            <h4 className={`text-sm font-medium mb-3 ${isDark ? 'text-gray-200' : 'text-gray-700'}`}>
              DeepSeek 配置
            </h4>
            <div className="space-y-3">
              <ConfigItem label="API Key" isDark={isDark}>
                <TextConfig
                  isDark={isDark}
                  type="password"
                  value={config.deepseek?.apiKey || ''}
                  onChange={(v) => handleDeepseekChange('apiKey', v)}
                  placeholder="sk-..."
                />
              </ConfigItem>
              <ConfigItem label="Base URL" isDark={isDark}>
                <TextConfig
                  isDark={isDark}
                  value={config.deepseek?.baseUrl || ''}
                  onChange={(v) => handleDeepseekChange('baseUrl', v)}
                  placeholder="https://api.deepseek.com"
                />
              </ConfigItem>
              <ConfigItem label="模型" isDark={isDark}>
                <TextConfig
                  isDark={isDark}
                  value={config.deepseek?.model || ''}
                  onChange={(v) => handleDeepseekChange('model', v)}
                  placeholder="deepseek-chat"
                />
              </ConfigItem>
            </div>
          </div>
        )}

        {config.provider === 'anthropic' && (
          <div className={`p-3 rounded border ${isDark ? 'border-gray-700 bg-gray-700/30' : 'border-gray-200 bg-gray-50'}`}>
            <h4 className={`text-sm font-medium mb-3 ${isDark ? 'text-gray-200' : 'text-gray-700'}`}>
              Anthropic 配置
            </h4>
            <div className="space-y-3">
              <ConfigItem label="API Key" isDark={isDark}>
                <TextConfig
                  isDark={isDark}
                  type="password"
                  value={config.anthropic?.apiKey || ''}
                  onChange={(v) => handleAnthropicChange('apiKey', v)}
                  placeholder="sk-ant-..."
                />
              </ConfigItem>
              <ConfigItem label="Base URL" isDark={isDark}>
                <TextConfig
                  isDark={isDark}
                  value={config.anthropic?.baseUrl || ''}
                  onChange={(v) => handleAnthropicChange('baseUrl', v)}
                  placeholder="https://api.anthropic.com"
                />
              </ConfigItem>
              <ConfigItem label="模型" isDark={isDark}>
                <TextConfig
                  isDark={isDark}
                  value={config.anthropic?.model || ''}
                  onChange={(v) => handleAnthropicChange('model', v)}
                  placeholder="claude-3-opus"
                />
              </ConfigItem>
            </div>
          </div>
        )}

        {config.provider === 'openai' && (
          <div className={`p-3 rounded border ${isDark ? 'border-gray-700 bg-gray-700/30' : 'border-gray-200 bg-gray-50'}`}>
            <h4 className={`text-sm font-medium mb-3 ${isDark ? 'text-gray-200' : 'text-gray-700'}`}>
              OpenAI 配置
            </h4>
            <div className="space-y-3">
              <ConfigItem label="API Key" isDark={isDark}>
                <TextConfig
                  isDark={isDark}
                  type="password"
                  value={config.openai?.apiKey || ''}
                  onChange={(v) => handleOpenaiChange('apiKey', v)}
                  placeholder="sk-..."
                />
              </ConfigItem>
              <ConfigItem label="Base URL" isDark={isDark}>
                <TextConfig
                  isDark={isDark}
                  value={config.openai?.baseUrl || ''}
                  onChange={(v) => handleOpenaiChange('baseUrl', v)}
                  placeholder="https://api.openai.com"
                />
              </ConfigItem>
              <ConfigItem label="模型" isDark={isDark}>
                <TextConfig
                  isDark={isDark}
                  value={config.openai?.model || ''}
                  onChange={(v) => handleOpenaiChange('model', v)}
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