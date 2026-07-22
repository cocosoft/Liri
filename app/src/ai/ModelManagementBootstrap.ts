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

import { Logger, LogLevel } from '@modules/monitoring';
import { handleError } from '@modules/error';

const logger = new Logger({
  module: 'ai:modelManagementBootstrap',
  level: LogLevel.INFO,
});

/** 环境变量 → Provider 映射 */
interface EnvPreset {
  key: string;
  baseUrlKey: string;
  defaultBaseUrl: string;
  name: string;
  providerType: string;
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
          providerType: preset.providerType as any,
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
    logger.warning('环境变量 seed 失败', {
      error: (err as Error).message,
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
      logger.warning(`模型管理服务初始化失败（非关键）: ${svc.name}`, {
        error: (err as Error).message,
      });
    }
  }

  // 从环境变量 seed Provider 到 DB
  let seeded = 0;
  try {
    const { providerManager } =
      await import('@modules/ai/providers/ProviderManager.js');
    await providerManager.initialize();
    const existing = await providerManager.listProviders();
    const dedupNames = new Set(
      existing.map((p) => `${p.name}:${p.providerType}`)
    );
    seeded = await seedEnvProvidersToDB(dedupNames);
  } catch (err) {
    logger.warning('seed 流程失败（非关键）', {
      error: (err as Error).message,
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
    logger.warning('DB供应商同步失败（非关键）', {
      error: (err as Error).message,
    });
  }

  if (initialized > 0 || synced > 0) {
    logger.info(
      `模型管理模块: ${initialized} DB服务, ${seeded} seed, ${synced} 已同步`
    );
  }
}
