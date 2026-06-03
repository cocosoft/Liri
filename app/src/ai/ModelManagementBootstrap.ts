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
 * 负责在应用启动时初始化所有新增服务（DB 表创建）。
 * 被 entrypoints/init.ts 调用，零初始化失败不影响核心流程。
 */

import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';

const logger = new Logger({ level: LogLevel.INFO });

/**
 * 初始化所有模型管理新增服务
 *
 * 非关键路径：任何服务初始化失败只记录 warning，不抛出异常。
 */
export async function initializeModelManagementServices(): Promise<void> {
  const services: Array<{ name: string; init: () => Promise<void> }> = [];

  try {
    const { providerManager } = await import(
      '@modules/ai/providers/ProviderManager.js'
    );
    services.push({
      name: 'ProviderManager',
      init: () => providerManager.initialize(),
    });
  } catch {
    // 模块不存在时静默跳过
  }

  try {
    const { usageStatsService } = await import(
      '@modules/ai/models/UsageStatsService.js'
    );
    services.push({
      name: 'UsageStatsService',
      init: () => usageStatsService.initialize(),
    });
  } catch {}

  try {
    const { modelPricingService } = await import(
      '@modules/ai/models/ModelPricingService.js'
    );
    services.push({
      name: 'ModelPricingService',
      init: () => modelPricingService.initialize(),
    });
  } catch {}

  try {
    const { appModelRouter } = await import(
      '@modules/ai/models/AppModelRouter.js'
    );
    services.push({
      name: 'AppModelRouter',
      init: () => appModelRouter.initialize(),
    });
  } catch {}

  // 逐个初始化，失败不影响后续
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

  // 同步 DB 供应商到 ProviderRegistry（在 registry 已有默认Provider后执行）
  try {
    const { syncDBProvidersToRegistry } = await import(
      '@modules/ai/providers/ProviderSyncService.js'
    );
    const synced = await syncDBProvidersToRegistry();
    if (synced > 0) {
      initialized++;
      logger.debug(`已同步 ${synced} 个 DB 供应商到 ProviderRegistry`);
    }
  } catch (err) {
    logger.warning('DB供应商同步失败（非关键）', {
      error: (err as Error).message,
    });
  }

  if (initialized > 0) {
    logger.info(`模型管理模块: ${initialized}/${services.length + 1} 服务已就绪`);
  }
}
