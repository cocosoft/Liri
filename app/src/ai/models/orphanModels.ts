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
 * 孤儿模型判定与收集（N-59 后续 · 2026-09-20）
 *
 * **孤儿模型** = `model_registry.provider_id` 形如 **UUID** 且该 UUID **不在** `ai_providers`
 * 中 —— 即绑定了一个已被删除的自定义供应商。这类模型不会出现在 `GET /v1/models`
 * （该端点要求有匹配供应商），用户在 UI 上不可见、无法重绑。
 *
 * **判据唯一来源（CS01）**：以下三处共用本模块，避免判据漂移 ——
 *   1. `ModelManagementBootstrap.disableModelsWithMissingProvider()`（启动自检，存量停用）
 *   2. `ModelAPI.handleListOrphanModels()`（`GET /v1/models/orphans`，供 UI 展示与重绑）
 *   3. 后续任何需要"是否孤儿"判断的调用方
 *
 * 注意：`provider_id` 存 **provider_type**（如 `deepseek`）的**松绑定**由
 * `ProviderRegistry.getByType` 解析成功，**不属孤儿**，一律不处理。
 */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface OrphanModel {
  /** `model_registry.id`（UUID，即会话 metadata.model 引用的键） */
  id: string;
  /** 模型名（如 `246676332`） */
  modelId: string;
  displayName: string;
  /** 已不存在的供应商 id */
  providerId: string;
  enabled: boolean;
  isCustom: boolean;
}

/**
 * 纯函数判据：该 `provider_id` 是否构成孤儿。
 * @param existingProviderIds 当前 `ai_providers` 中已存在的供应商 id 集合
 */
export function isOrphanProviderId(
  providerId: string | undefined,
  existingProviderIds: ReadonlySet<string>
): boolean {
  if (!providerId) return false;
  if (!UUID_RE.test(providerId)) return false; // 松绑定（provider_type 形态）不处理
  return !existingProviderIds.has(providerId);
}

/** 收集当前所有孤儿模型（供自检与 API 共用） */
export async function collectOrphanModels(): Promise<OrphanModel[]> {
  const { modelPricingService, providerManager } = await import('@modules/ai');
  await modelPricingService.initialize();
  await providerManager.initialize();

  const providers = await providerManager.listProviders();
  const providerIds = new Set(providers.map((p) => p.id));
  const all = await modelPricingService.getAllPricing();

  return all
    .filter((m) => isOrphanProviderId(m.providerId, providerIds))
    .map((m) => ({
      id: m.id,
      modelId: m.modelId,
      displayName: m.displayName || m.modelId,
      providerId: m.providerId as string,
      enabled: m.enabled,
      isCustom: m.isCustom === true,
    }));
}
