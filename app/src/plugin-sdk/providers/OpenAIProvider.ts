/**
 * OpenAIProvider - OpenAI 模型 Provider 扩展样例
 * 展示如何实现 ProviderPlugin 接口，注册 AI 模型提供者
 */

import {
  createProviderPlugin,
  type ProviderPlugin,
} from '../categories.js';

/**
 * OpenAI 配置
 */
export interface OpenAIProviderConfig {
  apiKey: string;
  baseUrl: string;
  organization?: string;
  models: string[];
  maxRetries: number;
  timeout: number;
}

/**
 * 创建 OpenAI Provider 插件实例
 * @param config 配置
 * @returns ProviderPlugin 实例
 */
export function createOpenAIProvider(
  config: Partial<OpenAIProviderConfig> = {}
): ProviderPlugin {
  const cfg: OpenAIProviderConfig = {
    apiKey: config.apiKey || '',
    baseUrl: config.baseUrl || 'https://api.openai.com/v1',
    organization: config.organization,
    models: config.models || [],
    maxRetries: config.maxRetries ?? 3,
    timeout: config.timeout ?? 30000,
  };

  return createProviderPlugin({
    id: 'provider-openai',
    name: 'OpenAI Provider',
    version: '1.0.0',
    description: 'OpenAI 模型提供者适配器，支持 GPT-4o/GPT-4/GPT-3.5 系列模型',
    author: 'Liri',
    tags: ['ai', 'llm', 'openai', 'provider'],
    providerName: 'openai',
    getModels: async () => cfg.models,
    healthCheck: async () => {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), cfg.timeout);
        const resp = await fetch(`${cfg.baseUrl}/models`, {
          headers: {
            Authorization: `Bearer ${cfg.apiKey}`,
            ...(cfg.organization
              ? { 'OpenAI-Organization': cfg.organization }
              : {}),
          },
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
