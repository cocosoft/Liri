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
import { createProviderByType } from './ProviderFactory';
import type { AIProvider, ProviderConfig } from './AIProvider';
import type { ProviderRecord } from './ProviderManager';
import { getLogger } from '@modules/monitoring';
import { handleError } from '@modules/error';

const logger = getLogger('ai:provider-sync');

/**
 * 将 DB ProviderRecord 转换为 ProviderConfig
 */
function recordToConfig(record: ProviderRecord): ProviderConfig {
  const config: ProviderConfig = {
    apiKey: record.apiKey || '',
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
    // KB-EMBED-FIX（2026-08-28）：把 DB 凭据直接挂到实例上——
    // BaseAIProvider.setApiKey 是空实现（子类按需覆盖），且 EmbeddingManager
    // _resolveEmbeddingProvider 直接读 provider.apiKey/baseUrl 字段；此前拿不到
    // DB 值，嵌入任务静默降级 local(Ollama) 后失败（已配置却"不可用"的根因）
    apiKey: {
      value: config.apiKey,
      configurable: true,
      enumerable: true,
    },
    baseUrl: {
      value: config.baseUrl,
      configurable: true,
      enumerable: true,
    },
  });

  if (providerRegistry.has(registryId)) {
    providerRegistry.unregister(registryId);
  }

  // 从 DB 配置设置 API Key（createProviderByType 未将 config.apiKey 传递给 Provider 构造函数）
  const wrappedRecord = wrapped as unknown as Record<string, unknown>;
  if (config.apiKey && typeof wrappedRecord.setApiKey === 'function') {
    (wrappedRecord.setApiKey as (key: string) => void)(config.apiKey);
  }

  providerRegistry.register(wrapped);

  // 注册类型别名，使 getByModel() 能通过 providerType 精确查找 DB 同步的 Provider
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
 * 同步内容：
 *   1. 供应商注册（providers 表 → ProviderRegistry）
 *   2. 模型→Provider 映射（model_registry 表 → getByModel 精确查找）
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
        void handleError(err, {
          module: 'ai:provider-sync',
          action: 'syncOneProvider',
          context: { name: record.name },
        });
      }
    }

    // 同步模型→Provider 映射（model_registry.model_id → providerType）
    await syncModelToProviderMappings(providers);

    if (count > 0) {
      logger.info(`已同步 ${count} 个 DB 供应商到 ProviderRegistry`);
    }

    return count;
  } catch (err) {
    void handleError(err, {
      module: 'ai:provider-sync',
      action: 'syncDBProvidersToRegistry',
    });
    return 0;
  }
}

/**
 * 从 model_registry 表构建模型名→Provider 类型映射
 * 注入到 ProviderRegistry 供 getByModel() 精确查找
 */
async function syncModelToProviderMappings(
  providerRecords: ProviderRecord[]
): Promise<void> {
  try {
    const { modelPricingService } =
      await import('@modules/ai/models/ModelPricingService.js');
    await modelPricingService.initialize();
    const allModels = await modelPricingService.getAllPricing();

    // 构建 providerId → providerType 的快速查找
    // 同时兼容 model_registry.provider_id 存 provider_type 类型名（如 'deepseek'）的场景
    const providerTypeById = new Map<string, string>();
    for (const p of providerRecords) {
      providerTypeById.set(p.id, p.providerType);
      providerTypeById.set(p.providerType, p.providerType);
    }

    const mappings = new Map<string, string>();
    for (const m of allModels) {
      if (!m.modelId || !m.providerId) continue;
      const providerType = providerTypeById.get(m.providerId);
      if (providerType) {
        mappings.set(m.modelId.toLowerCase(), providerType);
      }
    }

    providerRegistry.setModelMappings(mappings);
    logger.debug(`模型→Provider 映射已同步: ${mappings.size} 条`);
  } catch (err) {
    void handleError(err, {
      module: 'ai:provider-sync',
      action: 'syncModelToProviderMappings',
    });
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
    void handleError(err, {
      module: 'ai:provider-sync',
      action: 'registerProviderFromDB',
      context: { providerId },
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
