// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

/**
 * DB Provider → ProviderRegistry 同步桥接层
 *
 * 将 ai_providers 表中用户管理的供应商动态注入到 ProviderRegistry，
 * 使 /provider add 添加的供应商可直接通过 aiService 调用。
 *
 * 优先级：DB 供应商 > 环境变量/硬编码 Provider
 */

import { providerRegistry } from './ProviderRegistry';
import { AnthropicProvider } from './AnthropicProvider';
import { OpenAIProvider } from './OpenAIProvider';
import { DeepSeekProvider } from './DeepSeekProvider';
import { GoogleProvider } from './GoogleProvider';
import { OllamaProvider } from './OllamaProvider';
import { MoonshotProvider } from './MoonshotProvider';
import { GrokProvider } from './GrokProvider';
import { BedrockProvider } from './BedrockProvider';
import { VertexAIProvider } from './VertexAIProvider';
import { AzureOpenAIProvider } from './AzureOpenAIProvider';
import type { AIProvider, ProviderConfig } from './AIProvider';
import type { ProviderRecord, ProviderType } from './ProviderManager';
import { Logger, LogLevel } from '@modules/monitoring';
import { configManager } from '@modules/config';

const logger = new Logger({ level: LogLevel.INFO });

/** DB providerType → AIProvider 构造函数映射 */
function createProviderByType(
  type: ProviderType,
  config: ProviderConfig
): AIProvider | null {
  switch (type) {
    case 'anthropic':
      return new AnthropicProvider({
        providerId: 'anthropic',
        displayName: 'Anthropic Claude',
        defaultBaseUrl: 'https://api.anthropic.com',
        envApiKey: 'ANTHROPIC_API_KEY',
        defaultModel: (config?.model as string) || '',
      });
    case 'openai':
      return new OpenAIProvider({
        providerId: 'openai',
        displayName: 'OpenAI',
        defaultBaseUrl: 'https://api.openai.com/v1',
        envApiKey: 'OPENAI_API_KEY',
        defaultModel: (config?.model as string) || '',
      });
    case 'deepseek':
      return new DeepSeekProvider({
        providerId: 'deepseek',
        displayName: 'DeepSeek',
        defaultBaseUrl: 'https://api.deepseek.com',
        envApiKey: 'DEEPSEEK_API_KEY',
        defaultModel: (config?.model as string) || 'deepseek-v4-flash',
      });
    case 'google':
      return new GoogleProvider({
        providerId: 'google',
        displayName: 'Google Gemini',
        defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta',
        envApiKey: 'GOOGLE_API_KEY',
        defaultModel: (config?.model as string) || '',
      });
    case 'ollama':
      return new OllamaProvider({
        providerId: 'ollama',
        displayName: 'Ollama (Local)',
        defaultBaseUrl: 'http://localhost:11434',
        defaultModel: (config?.model as string) || '',
      });
    case 'moonshot':
      return new MoonshotProvider({
        providerId: 'moonshot',
        displayName: 'Moonshot (Kimi)',
        defaultBaseUrl: 'https://api.moonshot.cn/v1',
        envApiKey: 'MOONSHOT_API_KEY',
        defaultModel: (config?.model as string) || '',
      });
    case 'grok':
      return new GrokProvider({
        providerId: 'grok',
        displayName: 'Grok (X.AI)',
        defaultBaseUrl: 'https://api.x.ai/v1',
        envApiKey: 'GROK_API_KEY',
        defaultModel: (config?.model as string) || '',
      });
    case 'bedrock':
      return new BedrockProvider(
        {
          providerId: 'bedrock',
          displayName: 'AWS Bedrock',
          defaultModel: (config?.model as string) || '',
        },
        config
      );
    case 'vertex':
      return new VertexAIProvider(
        {
          providerId: 'vertex-ai',
          displayName: 'Google Vertex AI',
          defaultBaseUrl: 'https://us-central1-aiplatform.googleapis.com',
          defaultModel: (config?.model as string) || '',
        },
        config
      );
    case 'azure':
      return new AzureOpenAIProvider(
        {
          providerId: 'azure-openai',
          displayName: 'Azure OpenAI',
          defaultModel: (config?.model as string) || '',
        },
        config
      );
    default:
      // custom → 默认用 OpenAI 兼容格式
      return new OpenAIProvider({
        providerId: 'custom',
        displayName: 'Custom OpenAI-compatible',
        defaultBaseUrl:
          (config?.baseUrl as string) || 'https://api.openai.com/v1',
        envApiKey: 'OPENAI_API_KEY',
        defaultModel: (config?.model as string) || '',
      });
  }
}

/**
 * 将 DB ProviderRecord 转换为 ProviderConfig
 */
function recordToConfig(record: ProviderRecord): ProviderConfig {
  const config: ProviderConfig = {
    apiKey: record.apiKey || configManager.env('DEEPSEEK_API_KEY') || '',
    baseUrl: record.baseUrl,
  };

  // 注入自定义 headers（如果配置了）
  const headers = record.headers;
  if (headers && Object.keys(headers).length > 0) {
    config['headers'] = headers;
  }

  return config;
}

/**
 * 同步单个 DB 供应商到 ProviderRegistry
 */
function syncOneProvider(record: ProviderRecord): void {
  // 用 DB 的 UUID 作为 registry 中的 ID
  const registryId = `db:${record.id}`;
  const config = recordToConfig(record);
  const provider = createProviderByType(record.providerType, config);

  if (!provider) {
    logger.warning(`无法创建供应商: type=${record.providerType}`);
    return;
  }

  // 覆盖 provider 的 id 和 displayName 为 DB 中的值
  // 使用 Object.create 保留原型链（确保 chat、chatStream 等原型方法可用）
  const wrapped = Object.create(provider) as AIProvider;
  Object.defineProperties(wrapped, {
    id: {
      get() {
        return registryId;
      },
      configurable: true,
      enumerable: true,
    },
    displayName: {
      get() {
        return record.name;
      },
      configurable: true,
      enumerable: true,
    },
  });

  if (providerRegistry.has(registryId)) {
    providerRegistry.unregister(registryId);
  }

  // 从 DB 配置设置 API Key（createProviderByType 未将 config.apiKey 传递给 Provider 构造函数）
  if (config.apiKey && typeof (wrapped as any).setApiKey === 'function') {
    (wrapped as any).setApiKey(config.apiKey);
  }

  providerRegistry.register(wrapped);

  // 注册类型别名，使 getByModel() 能通过模型前缀（如 'qwen'→'ollama'）查找到
  // 该 DB 同步的 Provider（硬编码映射表用的 providerType，而非 db:uuid）
  providerRegistry.setProviderTypeAlias(record.providerType, registryId);

  logger.debug(`DB供应商已同步: ${record.name} (${registryId})`);
}

/** DB provider ID → Registry ID 的双向映射，用于 provide/setModel 回写 */
const dbToRegistry: Map<string, string> = new Map();

/**
 * 全量同步：从 DB 读取所有活跃供应商 → ProviderRegistry
 *
 * 保留环境变量注册的预置 Provider（id: anthropic/openai/deepseek 等），
 * 但优先使用 DB 中 active 的供应商。
 *
 * @returns 同步的供应商数量
 */
export async function syncDBProvidersToRegistry(): Promise<number> {
  try {
    const { providerManager } = await import('./ProviderManager.js');
    await providerManager.initialize();

    const providers = await providerManager.listProviders({ isActive: true });

    let count = 0;

    for (const record of providers) {
      try {
        syncOneProvider(record);
        dbToRegistry.set(record.id, `db:${record.id}`);
        count++;
      } catch (err) {
        logger.warning(`同步供应商失败: ${record.name}`, {
          error: (err as Error).message,
        });
      }
    }

    if (count > 0) {
      logger.info(`已同步 ${count} 个 DB 供应商到 ProviderRegistry`);
    }

    return count;
  } catch (err) {
    logger.warning('DB供应商同步失败（将使用环境变量预置Provider）', {
      error: (err as Error).message,
    });
    return 0;
  }
}

/**
 * 注册单个供应商到 Registry（供 /provider add 实时生效）
 */
export async function registerProviderFromDB(
  providerId: string
): Promise<boolean> {
  try {
    const { providerManager } = await import('./ProviderManager.js');
    await providerManager.initialize();

    const record = await providerManager.getProvider(providerId);
    if (!record) return false;

    syncOneProvider(record);
    dbToRegistry.set(record.id, `db:${record.id}`);
    return true;
  } catch (err) {
    logger.warning(`注册供应商失败: ${providerId}`, {
      error: (err as Error).message,
    });
    return false;
  }
}

/**
 * 从 Registry 中移除 DB 供应商（供 /provider delete 实时生效）
 */
export function unregisterProviderFromRegistry(providerId: string): boolean {
  const registryId = `db:${providerId}`;
  // unregister() 自动清理 providerTypeToId 中的对应条目
  dbToRegistry.delete(providerId);
  return providerRegistry.unregister(registryId);
}

/**
 * 获取 DB providerId 对应的 Registry ID
 */
export function getRegistryId(dbProviderId: string): string | undefined {
  return dbToRegistry.get(dbProviderId);
}

export const ProviderSyncService = {
  syncDBProvidersToRegistry,
  registerProviderFromDB,
  unregisterProviderFromRegistry,
  getRegistryId,
};
