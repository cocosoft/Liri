/**
 * AnthropicProvider - Anthropic 模型 Provider 扩展样例
 * 展示如何实现 ProviderPlugin 接口，注册 Anthropic Claude 模型提供者
 */

import {
  createProviderPlugin,
  type ProviderPlugin,
} from '../../plugin-sdk/index.js';

/**
 * Anthropic 配置
 */
export interface AnthropicProviderConfig {
  apiKey: string;
  baseUrl: string;
  models: string[];
  maxRetries: number;
  timeout: number;
}

/**
 * 创建 Anthropic Provider 插件实例
 * @param config 配置
 * @returns ProviderPlugin 实例
 */
export function createAnthropicProvider(
  config: Partial<AnthropicProviderConfig> = {}
): ProviderPlugin {
  const cfg: AnthropicProviderConfig = {
    apiKey: config.apiKey || '',
    baseUrl: config.baseUrl || 'https://api.anthropic.com/v1',
    models: config.models || [
      'claude-sonnet-4-20250514',
      'claude-opus-4-20250514',
      'claude-sonnet-4',
      'claude-opus-4',
    ],
    maxRetries: config.maxRetries ?? 3,
    timeout: config.timeout ?? 60000,
  };

  return createProviderPlugin({
    id: 'provider-anthropic',
    name: 'Anthropic Provider',
    version: '1.0.0',
    description:
      'Anthropic Claude 模型提供者适配器，支持 Claude Sonnet/Opus 系列模型',
    author: 'PY_APP',
    tags: ['ai', 'llm', 'anthropic', 'claude', 'provider'],
    providerName: 'anthropic',
    getModels: async () => cfg.models,
    healthCheck: async () => {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), cfg.timeout);
        const resp = await fetch(`${cfg.baseUrl}/messages`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': cfg.apiKey,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model: cfg.models[0] || 'claude-sonnet-4-20250514',
            max_tokens: 1,
            messages: [{ role: 'user', content: 'ping' }],
          }),
          signal: controller.signal,
        });
        clearTimeout(timer);
        return resp.ok;
      } catch {
        return false;
      }
    },
  });
}
