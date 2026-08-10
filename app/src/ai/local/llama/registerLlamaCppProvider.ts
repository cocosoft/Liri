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
 * ensureLlamaCppProviderRegistered — llama.cpp provider 注册（DB providers 表 → Registry）
 *
 * 遵循 §1.5 模型数据一致性：仅经 ProviderManager 写 DB，再经 syncDBProvidersToRegistry 同步，
 * 不绕过体系手动注册。llama-server 就绪后由启动链调用。
 */

import { getLogger } from '@modules/monitoring';
import { handleError } from '@modules/error';
import { basename, extname } from 'path';
import { llamaCppServerManager } from './LlamaCppServerManager.js';

const logger = getLogger('ai:llama');

const LLAMACPP_PROVIDER_TYPE = 'llamacpp' as const;

/**
 * 确保 llamacpp provider 已注册到 DB 与 Registry
 * @returns 是否注册成功（服务未运行返回 false）
 */
export async function ensureLlamaCppProviderRegistered(): Promise<boolean> {
  try {
    const status = await llamaCppServerManager.getStatus();
    if (!status.running) {
      logger.debug('llama-server 未运行，跳过 provider 注册');
      return false;
    }
    const host = status.host || '127.0.0.1';
    const baseUrl = `http://${host}:${status.port}/v1`;

    const { providerManager } =
      await import('@modules/ai/providers/ProviderManager.js');
    await providerManager.initialize();

    const existing = await providerManager.listProviders();
    const record = existing.find(
      (p) => p.providerType === LLAMACPP_PROVIDER_TYPE
    );

    if (record) {
      if (record.baseUrl !== baseUrl) {
        await providerManager.updateProvider(record.id, { baseUrl });
        logger.info(`llamacpp provider baseUrl 已更新: ${baseUrl}`);
      }
    } else {
      await providerManager.createProvider({
        name: 'llama.cpp',
        providerType: LLAMACPP_PROVIDER_TYPE,
        baseUrl,
        requiresAuth: false,
        isActive: true,
        category: 'third_party',
      });
      logger.info(`llamacpp provider 已注册: ${baseUrl}`);
    }

    const { syncDBProvidersToRegistry } =
      await import('@modules/ai/providers/ProviderSyncService.js');
    await syncDBProvidersToRegistry();

    // GGUF 模型同步到 model_registry（幂等），使模型可在应用列表/任务分工中使用
    await syncLlamaModelsToRegistry();
    return true;
  } catch (err) {
    await handleError(err, {
      module: 'ai:llama',
      action: 'ensureLlamaCppProviderRegistered',
    });
    return false;
  }
}

/**
 * 将 GGUF 目录扫描到的模型同步注册到 model_registry（幂等）。
 * 遵循 model-usage.md：DB 唯一事实源，经 ModelPricingService.upsertPricing 写入，
 * 不手写 SQL；完成后刷新 ModelRegistry 缓存与 ModelRouter UUID 缓存。
 * @returns 本次新增注册的模型数
 */
export async function syncLlamaModelsToRegistry(): Promise<number> {
  try {
    const status = await llamaCppServerManager.getStatus();
    if (!status.running) return 0;

    const { providerManager } =
      await import('@modules/ai/providers/ProviderManager.js');
    await providerManager.initialize();
    const provider = (await providerManager.listProviders()).find(
      (p) => p.providerType === LLAMACPP_PROVIDER_TYPE
    );
    if (!provider) return 0;
    const providerId = provider.id;
    const contextWindow = llamaCppServerManager.getConfig().contextWindow;

    const { modelPricingService } =
      await import('@modules/ai/models/ModelPricingService.js');
    await modelPricingService.initialize();

    let registered = 0;
    for (const ggufPath of status.models) {
      const ext = extname(ggufPath);
      if (ext.toLowerCase() !== '.gguf') continue;
      const modelId = basename(ggufPath, ext);
      if (!modelId) continue;

      const existing = await modelPricingService.getPricing(modelId);
      if (existing) {
        if (existing.providerId === providerId) continue; // 已注册且归属本 provider
        logger.warning(
          `模型 ${modelId} 已被其他 provider 占用，跳过 GGUF 注册`
        );
        continue;
      }

      await modelPricingService.upsertPricing({
        modelId,
        displayName: modelId,
        providerId,
        contextWindow,
        maxOutputTokens: 8192,
        capabilities: ['chat', 'streaming'],
        inputCostPerMillion: 0,
        outputCostPerMillion: 0,
      });
      registered++;
    }

    if (registered > 0) {
      const { ModelRegistry } =
        await import('@modules/ai/models/ModelRegistry.js');
      ModelRegistry.getInstance()
        .refreshDbPricing()
        .catch((er: unknown) => {
          // @ignore-catch: 非关键缓存刷新
          logger.warning('refreshDbPricing 失败(llama sync)', {
            error: (er as Error).message,
          });
        });
      const { modelRouter } = await import('@modules/ai/modelRouter.js');
      modelRouter.invalidateUuidCache().catch((er: unknown) => {
        // @ignore-catch: 非关键缓存刷新
        logger.warning('invalidateUuidCache 失败(llama sync)', {
          error: (er as Error).message,
        });
      });
      logger.info(`已同步 ${registered} 个 GGUF 模型到 model_registry`);
    }
    return registered;
  } catch (err) {
    await handleError(err, {
      module: 'ai:llama',
      action: 'syncLlamaModelsToRegistry',
    });
    return 0;
  }
}
