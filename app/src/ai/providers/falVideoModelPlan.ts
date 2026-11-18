// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * FAL 视频生成的**模型与能力解析**（从 `FALProvider.generateVideo` 外移，纯函数）
 *
 * 为什么外移：`generateVideo` 是「提交 → 轮询 → 下载」的 IO 编排，`complexity` 告警 42
 * （阈值 40）。本段是其中唯一的**纯判据**（无 IO、无 this 状态）⇒ 外移既降复杂度，也获得
 * 可直接单测的接缝。
 *
 * 清单**由调用方传入**（不 import `FALProvider` 的本模块常量）：既避免模块环，也让用例可用
 * 假清单断言回落语义。
 *
 * 语义（逐字保留）：模型 id 取自「入参 → 供应商默认模型 → 清单首项」；清单命中则用其能力，
 * 未命中回落到 5s/10s + 16:9（清单仅作**能力提示**，不作校验依据）。
 */

export interface FalVideoAbility {
  durations: number[];
  aspectRatios: string[];
}

/** 解析所需的最小清单项（`FAL_VIDEO_MODELS` 天然满足） */
export interface FalVideoModelCandidate {
  id: string;
  capabilities?: FalVideoAbility;
}

export interface FalVideoModelPlan<M extends FalVideoModelCandidate> {
  modelId: string;
  /** 命中的清单项（未命中 ⇒ undefined） */
  modelConfig: M | undefined;
  /** 实际使用的能力（未命中清单时回落默认值） */
  caps: FalVideoAbility;
}

/** 未命中清单时的能力回落（与改动前逐字一致） */
export const DEFAULT_FAL_VIDEO_ABILITY: FalVideoAbility = {
  durations: [5, 10],
  aspectRatios: ['16:9'],
};

/**
 * 解析本次视频生成要用的模型与能力。
 *
 * @param requestedModel 调用方显式指定的模型（可空）
 * @param providerDefaultModel 供应商配置的默认模型（可空）
 * @param models 能力提示清单（生产侧传 `FAL_VIDEO_MODELS`）
 */
export function resolveFalVideoModelPlan<M extends FalVideoModelCandidate>(
  requestedModel: string | undefined,
  providerDefaultModel: string | undefined,
  models: readonly M[]
): FalVideoModelPlan<M> {
  const modelId = requestedModel || providerDefaultModel || models[0]?.id || '';
  const modelConfig = models.find((m) => m.id === modelId);
  const caps = modelConfig?.capabilities || DEFAULT_FAL_VIDEO_ABILITY;
  return { modelId, modelConfig, caps };
}
