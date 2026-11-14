/**
 * 本地模型服务一键接入（G1，2026-11-14）
 *
 * 「接入」= 写 providers 表（`requiresAuth=false`）+ 同步到运行时 Registry +
 * 把探测到的真实模型写入 `model_registry`（成本 0），使 `/v1/models` 与任务路由立即可用。
 *
 * 分工：
 *  - Ollama：**复用** `ensureOllamaProviderRegistered()`（含 `/api/tags` 同步与真实上下文窗口探测），
 *    本文件不重复实现。
 *  - LM Studio / LocalAI：按供应商预设口径注册 `custom` provider，模型取探测结果。
 *
 * 遵循 §1.5 模型数据一致性：只经 ProviderManager 写 DB，再经 syncDBProvidersToRegistry 同步。
 */
import { getLogger } from '@openliri/infra/monitoring';
import { handleError } from '@openliri/infra/error';
import type { DetectedLocalService } from './detectLocalServices.js';

const logger = getLogger('ai:local');

/**
 * LM Studio / LocalAI 未提供可靠的上下文窗口探测接口（`/v1/models` 不含该字段）⇒
 * 取保守默认值：过大会被服务端拒绝，过小只是浪费窗口。
 */
const DEFAULT_LOCAL_CONTEXT_WINDOW = 8192;
const DEFAULT_LOCAL_MAX_OUTPUT_TOKENS = 4096;

/**
 * 接入一个已探测到的本地服务。
 * @returns 是否成功（服务不可达或写库失败返回 false，不抛异常）
 */
export async function ensureLocalModelProviderRegistered(
  service: DetectedLocalService
): Promise<boolean> {
  if (service.kind === 'ollama') {
    const { ensureOllamaProviderRegistered } =
      await import('./ollama/registerOllamaProvider.js');
    return await ensureOllamaProviderRegistered();
  }

  try {
    const { getProviderManager } =
      await import('../providers/ProviderManager.js');
    const { syncDBProvidersToRegistry } =
      await import('../providers/ProviderSyncService.js');
    const { modelPricingService } =
      await import('../models/ModelPricingService.js');

    const providerManager = getProviderManager();
    await providerManager.initialize();

    const existing = (await providerManager.listProviders()).find(
      (p) => p.name === service.displayName
    );
    const providerId =
      existing?.id ??
      (
        await providerManager.createProvider({
          name: service.displayName,
          providerType: service.providerType,
          baseUrl: service.baseUrl,
          requiresAuth: false,
          isActive: true,
          category: 'third_party',
        })
      ).id;
    if (existing) {
      // 服务地址可能变了（用户换端口）⇒ 跟随探测结果
      if (existing.baseUrl !== service.baseUrl) {
        await providerManager.updateProvider(existing.id, {
          baseUrl: service.baseUrl,
        });
      }
    } else {
      logger.info(`${service.displayName} provider 已注册: ${service.baseUrl}`);
    }

    await syncDBProvidersToRegistry();

    await modelPricingService.initialize();
    let registered = 0;
    for (const modelId of service.models) {
      const current = await modelPricingService.getPricing(modelId);
      // 已归属其它供应商的模型不抢占（与 Ollama 同步口径一致）
      if (current && current.providerId !== providerId) continue;
      await modelPricingService.upsertPricing({
        modelId,
        displayName: modelId,
        providerId,
        contextWindow: DEFAULT_LOCAL_CONTEXT_WINDOW,
        maxOutputTokens: DEFAULT_LOCAL_MAX_OUTPUT_TOKENS,
        capabilities: ['streaming', 'function_calling', 'tool_use'],
        inputCostPerMillion: 0,
        outputCostPerMillion: 0,
      });
      registered++;
    }

    if (registered > 0) {
      const { ModelRegistry } = await import('../models/ModelRegistry.js');
      ModelRegistry.getInstance()
        .refreshDbPricing()
        .catch((err: unknown) => {
          // @ignore-catch: 非关键缓存刷新
          logger.warning('refreshDbPricing 失败(local sync)', {
            error: (err as Error).message,
          });
        });
      const { modelRouter } = await import('../modelRouter.js');
      modelRouter.invalidateUuidCache().catch((err: unknown) => {
        // @ignore-catch: 非关键缓存刷新
        logger.warning('invalidateUuidCache 失败(local sync)', {
          error: (err as Error).message,
        });
      });
      logger.info(
        `${service.displayName} 模型同步: 新增/更新 ${registered}（共探测 ${service.models.length}）`
      );
    }
    return true;
  } catch (err) {
    await handleError(err, {
      module: 'ai:local',
      action: 'ensureLocalModelProviderRegistered',
    });
    return false;
  }
}
