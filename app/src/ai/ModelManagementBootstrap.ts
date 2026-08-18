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
 * 模型管理模块启动引导
 *
 * 统一接管所有 AI Provider 的初始化流程：
 *   1. 创建 DB 表（ProviderManager / UsageStatsService / ModelPricingService）
 *   2. 从环境变量读取 API Key，写入 DB（seed）
 *   3. 从 DB 同步活跃 Provider 到 ProviderRegistry（chat 可用）
 *
 * 此后 chat 调用完全走 DB Provider → Registry 链路，
 * 不再依赖 registerDefaultProviders。
 */

import { getLogger } from '@modules/monitoring';
import { handleError } from '@modules/error';
import type { ProviderType } from '@modules/ai/providers/ProviderManager.js';

const logger = getLogger('ai:modelManagementBootstrap');

/** 环境变量 → Provider 映射 */
interface EnvPreset {
  key: string;
  baseUrlKey: string;
  defaultBaseUrl: string;
  name: string;
  providerType: ProviderType;
}

const ENV_PRESETS: EnvPreset[] = [
  {
    key: 'DEEPSEEK_API_KEY',
    baseUrlKey: 'DEEPSEEK_BASE_URL',
    defaultBaseUrl: 'https://api.deepseek.com',
    name: 'DeepSeek',
    providerType: 'deepseek',
  },
  {
    key: 'OPENAI_API_KEY',
    baseUrlKey: 'OPENAI_BASE_URL',
    defaultBaseUrl: 'https://api.openai.com/v1',
    name: 'OpenAI',
    providerType: 'openai',
  },
  {
    key: 'ANTHROPIC_API_KEY',
    baseUrlKey: '',
    defaultBaseUrl: 'https://api.anthropic.com',
    name: 'Anthropic',
    providerType: 'anthropic',
  },
  {
    key: 'GOOGLE_API_KEY',
    baseUrlKey: 'GOOGLE_AI_BASE_URL',
    defaultBaseUrl: 'https://generativelanguage.googleapis.com',
    name: 'Google Gemini',
    providerType: 'google',
  },
  // GOOGLE_API_KEY 的别名
  {
    key: 'GEMINI_API_KEY',
    baseUrlKey: 'GOOGLE_AI_BASE_URL',
    defaultBaseUrl: 'https://generativelanguage.googleapis.com',
    name: 'Google Gemini',
    providerType: 'google',
  },
  {
    key: 'SILICONFLOW_API_KEY',
    baseUrlKey: '',
    defaultBaseUrl: 'https://api.siliconflow.cn/v1',
    name: 'SiliconFlow',
    providerType: 'custom',
  },
  {
    key: 'MOONSHOT_API_KEY',
    baseUrlKey: 'MOONSHOT_BASE_URL',
    defaultBaseUrl: 'https://api.moonshot.cn/v1',
    name: 'Moonshot',
    providerType: 'moonshot',
  },
  {
    key: 'GROK_API_KEY',
    baseUrlKey: 'GROK_BASE_URL',
    defaultBaseUrl: 'https://api.x.ai/v1',
    name: 'Grok',
    providerType: 'grok',
  },
];

/**
 * model_registry 引用但 ai_providers 缺失时的补录预设
 * （数出同源：确保 DB Provider 覆盖所有已注册模型引用的 provider）
 * apiKey 从对应环境变量读取，无则留空（模型显示为待配置，仍可见可管理）
 */
const REFERENCED_PROVIDER_PRESETS: Array<{
  providerType: string;
  name: string;
  baseUrl: string;
  requiresAuth: boolean;
  envKey: string;
}> = [
  {
    providerType: 'deepseek',
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com',
    requiresAuth: true,
    envKey: 'DEEPSEEK_API_KEY',
  },
  {
    providerType: 'openai',
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    requiresAuth: true,
    envKey: 'OPENAI_API_KEY',
  },
  {
    providerType: 'google',
    name: 'Google Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    requiresAuth: true,
    envKey: 'GOOGLE_API_KEY',
  },
  {
    providerType: 'anthropic',
    name: 'Anthropic',
    baseUrl: 'https://api.anthropic.com',
    requiresAuth: true,
    envKey: 'ANTHROPIC_API_KEY',
  },
  {
    providerType: 'llamacpp',
    name: 'Llama.cpp',
    baseUrl: 'http://localhost:8080',
    requiresAuth: false,
    envKey: '',
  },
  {
    providerType: 'ollama',
    name: 'Ollama',
    baseUrl: 'http://localhost:11434',
    requiresAuth: false,
    envKey: '',
  },
];

/**
 * 从环境变量检测并写入 DB
 * 已存在的供应商（按 name + providerType 去重）跳过
 */
async function seedEnvProvidersToDB(dedupNames: Set<string>): Promise<number> {
  try {
    const { providerManager } =
      await import('@modules/ai/providers/ProviderManager.js');
    await providerManager.initialize();

    let seeded = 0;

    for (const preset of ENV_PRESETS) {
      const apiKey = process.env[preset.key];
      if (!apiKey) continue;

      const dedupKey = `${preset.name}:${preset.providerType}`;
      if (dedupNames.has(dedupKey)) continue;

      const baseUrl =
        (preset.baseUrlKey ? process.env[preset.baseUrlKey] : undefined) ||
        preset.defaultBaseUrl;

      try {
        await providerManager.createProvider({
          name: preset.name,
          providerType: preset.providerType,
          baseUrl,
          apiKey,
        });
        dedupNames.add(dedupKey);
        seeded++;
      } catch (err) {
        logger.debug(`seed provider 跳过: ${preset.name}`, {
          error: (err as Error).message,
        });
      }
    }

    return seeded;
  } catch (err) {
    void handleError(err, {
      module: 'ai:modelManagementBootstrap',
      action: 'seedEnvProviders',
    });
    return 0;
  }
}

/**
 * 补录 model_registry 引用但 ai_providers 缺失的 Provider
 *
 * 数出同源：model_registry 的 provider_id 必须能在 ai_providers 中找到对应记录，
 * 否则 handleListModels 按 DB provider 匹配会把这些模型过滤掉，前端不可见、不可管理。
 *
 * 幂等：按 providerType 去重，已存在跳过，不覆盖用户已有配置。
 */
async function ensureReferencedProviders(
  dedupNames: Set<string>
): Promise<number> {
  try {
    const { modelPricingService } =
      await import('@modules/ai/models/ModelPricingService.js');
    await modelPricingService.initialize();
    const { providerManager } =
      await import('@modules/ai/providers/ProviderManager.js');
    await providerManager.initialize();

    // 1. 收集 model_registry 引用的所有 provider_id（去重）
    const allModels = await modelPricingService.getAllPricing();
    const referencedTypes = new Set(
      allModels.map((m) => m.providerId).filter(Boolean) as string[]
    );

    // 2. 当前 DB 已存在的 provider_type
    const existing = await providerManager.listProviders();
    const existingTypes = new Set<string>(existing.map((p) => p.providerType));

    // 3. 对缺失的 provider_type 补录（内置预设默认配置）
    let seeded = 0;
    for (const type of referencedTypes) {
      const preset = REFERENCED_PROVIDER_PRESETS.find(
        (p) => p.providerType === type
      );
      if (!preset) continue; // 未知类型（如自定义 UUID 的 provider）跳过
      if (existingTypes.has(type)) continue;
      if (dedupNames.has(`${preset.name}:${type}`)) continue;

      try {
        await providerManager.createProvider({
          name: preset.name,
          providerType: preset.providerType as ProviderType,
          baseUrl: preset.baseUrl,
          apiKey: preset.envKey
            ? process.env[preset.envKey] || undefined
            : undefined,
          requiresAuth: preset.requiresAuth,
        });
        dedupNames.add(`${preset.name}:${type}`);
        seeded++;
        logger.info(`补录缺失 Provider: ${preset.name} (${type})`);
      } catch (err) {
        logger.debug(`补录 Provider 跳过: ${preset.name}`, {
          error: (err as Error).message,
        });
      }
    }

    return seeded;
  } catch (err) {
    void handleError(err, {
      module: 'ai:modelManagementBootstrap',
      action: 'ensureReferencedProviders',
    });
    return 0;
  }
}

/**
 * 初始化所有模型管理新增服务
 *
 * 完整流程:
 *   1. 创建 DB 表
 *   2. 从环境变量 seed Provider 到 DB
 *   3. 从 DB 同步活跃 Provider 到 ProviderRegistry
 *
 * 非关键路径：任何步骤失败只记录 warning，不抛出异常。
 */
export async function initializeModelManagementServices(): Promise<void> {
  const services: Array<{ name: string; init: () => Promise<void> }> = [];

  try {
    const { providerManager } =
      await import('@modules/ai/providers/ProviderManager.js');
    services.push({
      name: 'ProviderManager',
      init: () => providerManager.initialize(),
    });
  } catch (err) {
    // 模块不存在时静默跳过
  }

  try {
    const { usageStatsService } =
      await import('@modules/ai/models/UsageStatsService.js');
    services.push({
      name: 'UsageStatsService',
      init: () => usageStatsService.initialize(),
    });
  } catch (err) {
    void handleError(err, {
      module: 'ai:ModelManagementBootstrap.ts',
      action: 'catch_error',
    });
  }

  try {
    const { modelPricingService } =
      await import('@modules/ai/models/ModelPricingService.js');
    services.push({
      name: 'ModelPricingService',
      init: () => modelPricingService.initialize(),
    });
  } catch (err) {
    void handleError(err, {
      module: 'ai:ModelManagementBootstrap.ts',
      action: 'catch_error',
    });
  }

  try {
    const { appModelConfigService } =
      await import('@modules/ai/models/AppModelConfigService.js');
    services.push({
      name: 'AppModelConfigService',
      init: () => appModelConfigService.initialize(),
    });
  } catch (err) {
    void handleError(err, {
      module: 'ai:ModelManagementBootstrap.ts',
      action: 'catch_error',
    });
  }

  try {
    const { getCapabilityService } =
      await import('@modules/ai/services/CapabilityService.js');
    const capabilityService = getCapabilityService();
    services.push({
      name: 'CapabilityService',
      init: () => capabilityService.init(),
    });
  } catch (err) {
    void handleError(err, {
      module: 'ai:ModelManagementBootstrap.ts',
      action: 'catch_error',
    });
  }

  // 逐个初始化 DB 表
  let initialized = 0;

  for (const svc of services) {
    try {
      await svc.init();
      initialized++;
      logger.debug(`模型管理服务已初始化: ${svc.name}`);
    } catch (err) {
      void handleError(err, {
        module: 'ai:modelManagementBootstrap',
        action: 'initService',
        context: { serviceName: svc.name },
      });
    }
  }

  // 从环境变量 seed Provider 到 DB + 补录 model_registry 引用的缺失 Provider
  let seeded = 0;
  let referenced = 0;
  try {
    const { providerManager } =
      await import('@modules/ai/providers/ProviderManager.js');
    await providerManager.initialize();
    const existing = await providerManager.listProviders();
    const dedupNames = new Set(
      existing.map((p) => `${p.name}:${p.providerType}`)
    );
    seeded = await seedEnvProvidersToDB(dedupNames);
    referenced = await ensureReferencedProviders(dedupNames);
  } catch (err) {
    void handleError(err, {
      module: 'ai:modelManagementBootstrap',
      action: 'seedProvidersToDB',
    });
  }

  // 同步 DB Provider 到 ProviderRegistry（chat 可用）
  let synced = 0;
  try {
    const { syncDBProvidersToRegistry } =
      await import('@modules/ai/providers/ProviderSyncService.js');
    synced = await syncDBProvidersToRegistry();
    if (synced > 0) {
      logger.info(`已同步 ${synced} 个 DB 供应商到 ProviderRegistry`);
    }
  } catch (err) {
    void handleError(err, {
      module: 'ai:modelManagementBootstrap',
      action: 'syncDBProvidersToRegistry',
    });
  }

  if (initialized > 0 || synced > 0) {
    logger.info(
      `模型管理模块: ${initialized} DB服务, ${seeded} seed, ${synced} 已同步`
    );
  }
}
