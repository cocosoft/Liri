/**
 * modelConfigRefs — 「模型失效后清理任务分工 / 当前模型对它的引用」的**单一实现**
 *
 * 为什么需要：`ai_app_model_configs`（任务分工 `chat`/`default`/…、`current`、`phase_*` 直配）
 * 里存的是 `model_registry.id`。两条会让它**悬空**的路径必须都清理：
 *   1. **删除模型** —— 原 `ModelRouter.cleanupTaskRef` 已覆盖；
 *   2. **删除供应商** —— 只会把强绑定模型置 `enabled=0`（N-59），**不删模型** ⇒
 *      配置行仍指着"孤儿模型"，切到这些任务时报「供应商未找到或未启用」。
 *
 * 为什么用注入的 `store`：`AppModelConfigService` 是模块级单例（构造期钉死 dbPath），
 * 直接对 DB 做断言会写进真实 `~/.pyapp/data/app.db`；注入后可用内存假 store 做接线级回归，
 * 产品代码仍复用同一实现（不产生第二套清理逻辑）。
 */

/** 配置服务的**最小面**（`AppModelConfigService` 直接满足） */
export interface ModelConfigRefStore {
  getConfig(appType: string): Promise<{ model?: string } | null | undefined>;
  deleteConfig(appType: string): Promise<boolean>;
}

/**
 * 删除所有「`model === modelId`」的配置行。
 *
 * @param modelId  要清理的模型 ID（`model_registry.id`）
 * @param store    配置服务（生产传 `appModelConfigService`）
 * @param appTypes 要检查的 app_type 全量（调用方给 `ALL_TASK_TYPES + 'current' + phase_*`）
 * @returns **实际被删除**的 app_type（调用方据此更新内存缓存与依赖登记）
 */
export async function purgeModelRefs(
  modelId: string,
  store: ModelConfigRefStore,
  appTypes: readonly string[]
): Promise<string[]> {
  const purged: string[] = [];
  // 空 ID 一律不动：`model === ''` 的行表示"未配置"，不能当命中
  if (!modelId) return purged;

  for (const appType of appTypes) {
    const config = await store.getConfig(appType);
    if (!config || config.model !== modelId) continue;
    await store.deleteConfig(appType);
    purged.push(appType);
  }
  return purged;
}
