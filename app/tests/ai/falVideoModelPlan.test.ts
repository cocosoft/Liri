// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * `resolveFalVideoModelPlan` 用例（P3-2：`FALProvider.generateVideo` 降复杂度的同时补判据测试）
 *
 * 锁住三级取值顺序（入参 → 供应商默认 → 清单首项）与「未命中清单 ⇒ 能力回落」。
 */
import { describe, it, expect } from 'bun:test';
import {
  resolveFalVideoModelPlan,
  DEFAULT_FAL_VIDEO_ABILITY,
  type FalVideoModelCandidate,
} from '@modules/ai/providers/falVideoModelPlan';

const MODELS: FalVideoModelCandidate[] = [
  {
    id: 'fal-ai/video-a',
    capabilities: { durations: [5], aspectRatios: ['9:16'] },
  },
  { id: 'fal-ai/video-b' },
];

describe('resolveFalVideoModelPlan', () => {
  it('显式入参优先，且命中清单时用其能力', () => {
    const plan = resolveFalVideoModelPlan(
      'fal-ai/video-a',
      'fal-ai/video-b',
      MODELS
    );
    expect(plan.modelId).toBe('fal-ai/video-a');
    expect(plan.caps).toEqual({ durations: [5], aspectRatios: ['9:16'] });
  });

  it('未传入参 ⇒ 用供应商默认模型', () => {
    const plan = resolveFalVideoModelPlan(undefined, 'fal-ai/video-b', MODELS);
    expect(plan.modelId).toBe('fal-ai/video-b');
  });

  it('两者皆空 ⇒ 取清单首项', () => {
    const plan = resolveFalVideoModelPlan(undefined, undefined, MODELS);
    expect(plan.modelId).toBe('fal-ai/video-a');
  });

  it('命中清单但该模型缺 capabilities ⇒ 回落默认能力', () => {
    const plan = resolveFalVideoModelPlan('fal-ai/video-b', undefined, MODELS);
    expect(plan.caps).toEqual(DEFAULT_FAL_VIDEO_ABILITY);
  });

  it('清单未命中 ⇒ modelConfig 为空且能力回落（清单仅作提示，不作校验）', () => {
    const plan = resolveFalVideoModelPlan(
      'third-party/model',
      undefined,
      MODELS
    );
    expect(plan.modelId).toBe('third-party/model');
    expect(plan.modelConfig).toBeUndefined();
    expect(plan.caps).toEqual(DEFAULT_FAL_VIDEO_ABILITY);
  });

  it('清单为空 ⇒ modelId 退化为空串，能力回落', () => {
    const plan = resolveFalVideoModelPlan(undefined, undefined, []);
    expect(plan.modelId).toBe('');
    expect(plan.caps).toEqual(DEFAULT_FAL_VIDEO_ABILITY);
  });
});
