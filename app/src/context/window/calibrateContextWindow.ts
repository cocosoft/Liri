/**
 * context_window 被动校准（原 `utils/ContextWindowResolver.calibrateContextWindow`）
 *
 * 2026-10-31 上移至 app：本函数读 `ModelRegistry` 并**写 `model_registry`**，属模型目录的领域动作，
 * 按 `infra-layer-boundary-contract.md §3` 判据（含业务编排 ⇒ 出 infra）应落 app。
 * 原在 `utils`(infra) 只能以 `await import('@modules/ai')` + 相对路径动态导入 app 层
 * （R00-003 盲区，`lint:infra` R3 已登记为清零目标）—— 上移后该动态边消失。
 *
 * 被动校准：API 返回 context 超限错误时，把服务端真实 n_ctx 回写 DB `model_registry`，
 * 使应用侧 context_window 自动跟随模型真实能力（云端 / Ollama / llama.cpp 通用）。
 * 仅当值不同时更新；失败静默，不阻断请求错误处理链。
 * DB 是唯一事实源，写 DB 后刷新 ModelRegistry 运行时缓存。
 */
import { ModelRegistry, modelPricingService } from '@modules/ai';
import { getLogger } from '@modules/monitoring';

const logger = getLogger('context:window');

export async function calibrateContextWindow(
  model: string,
  actualLimit: number
): Promise<boolean> {
  if (!model || !(actualLimit > 0)) return false;
  try {
    const registry = ModelRegistry.getInstance();
    const existing = registry.getModel(model);
    const current = existing?.contextWindow ?? 0;
    if (current === actualLimit) return false; // 已一致

    await modelPricingService.initialize();
    const rec = await modelPricingService.getPricing(model);
    if (!rec) return false; // 模型未注册，不校准
    // upsertPricing 更新已有记录时仅 contextWindow 生效，但 input/output 价格必填且会被覆盖，
    // 必须传回原值，避免校准把价格清零
    await modelPricingService.upsertPricing({
      modelId: model,
      contextWindow: actualLimit,
      inputCostPerMillion: rec.inputCostPerMillion,
      outputCostPerMillion: rec.outputCostPerMillion,
    });
    registry.refreshDbPricing().catch(() => {
      // @ignore-catch: 缓存刷新失败不影响 DB 事实源
    });
    logger.info('contextWindow 已自动校准（API 400 回写）', {
      model,
      from: current,
      to: actualLimit,
    });
    return true;
  } catch (err) {
    logger.warn('contextWindow 自动校准失败', {
      model,
      actualLimit,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}
