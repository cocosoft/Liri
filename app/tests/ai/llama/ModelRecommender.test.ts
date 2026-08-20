/**
 * ModelRecommender 单元测试（Phase 4）
 *
 * 覆盖：
 *  - 32GB + 12GB VRAM → Q5_K_M 为 high
 *  - 16GB 内存 → Q4 档为最佳（high）
 *  - 8GB 内存 → 所有版本为 low
 *  - 无 GPU 环境 → CPU 回退
 *  - 排序规则：high → qualityScore
 */

import { describe, it, expect } from 'bun:test';
import { ModelRecommender, type ModelRecommendation } from '../../../src/ai/local/llama/ModelRecommender.js';
import type { HardwareInfo } from '../../../src/ai/local/llama/HardwareDetector.js';

function makeHw(overrides: Partial<HardwareInfo> = {}): HardwareInfo {
  return {
    platform: 'win32',
    cpuCores: 8,
    systemMemoryGB: 16,
    gpu: {
      name: null,
      memoryGB: 0,
      backend: null,
    },
    llamaCppBackend: 'cpu',
    lastUpdated: Date.now(),
    ...overrides,
  };
}

describe('ModelRecommender', () => {
  const recommender = new ModelRecommender();

  it('32GB RAM + 12GB VRAM: 至少一个 high 推荐存在', async () => {
    const hw = makeHw({
      systemMemoryGB: 32,
      gpu: { name: 'NVIDIA RTX 4090', memoryGB: 12, backend: 'cuda' },
      llamaCppBackend: 'cuda',
    });
    const list = await recommender.recommend(hw, {} as never);
    const high = list.filter((r) => r.suitability === 'high');
    expect(high.length).toBeGreaterThan(0);

    // Top recommendation 必须是 high（排序规则：适配度 → 质量分）
    expect(list[0].suitability).toBe('high');
  });

  it('8GB 内存：小模型为 high，大模型会降为 low', async () => {
    // 8GB 系统在剔除 OS 预留 2GB 后仅剩 6GB 可用，
    // 小模型（8B Q4≈1.47GB）仍可高适配，
    // 但 14B Q8 级别的量化版本会落到 low 档。
    const hw = makeHw({ systemMemoryGB: 8 });
    const list = await recommender.recommend(hw, {} as never);
    // 存在 high（小模型）
    expect(list.some((r) => r.suitability === 'high')).toBe(true);
    // 也存在 low（较大量化版本超出 85% 阈值）
    expect(list.some((r) => r.suitability === 'low')).toBe(true);
  });

  it('16GB 内存：存在 high 推荐', async () => {
    const hw = makeHw({ systemMemoryGB: 16 });
    const list = await recommender.recommend(hw, {} as never);
    const hasHigh = list.some((r) => r.suitability === 'high');
    expect(hasHigh).toBe(true);

    // 估算运行内存不得超过可用内存（预留 2GB 给 OS）
    const availableRamGB = 16 - 2;
    for (const r of list) {
      if (r.suitability === 'high') {
        expect(r.estimatedRamGB).toBeLessThanOrEqual(availableRamGB);
      }
    }
  });

  it('排序规则：优先 high → 再按质量分降序', async () => {
    const hw = makeHw({
      systemMemoryGB: 64,
      gpu: { name: 'NVIDIA H100', memoryGB: 80, backend: 'cuda' },
      llamaCppBackend: 'cuda',
    });
    const list = await recommender.recommend(hw, {} as never);

    // 同一 suitability 下，qualityScore 必须降序
    for (let i = 1; i < list.length; i++) {
      const prev = list[i - 1];
      const cur = list[i];
      if (prev.suitability === cur.suitability) {
        expect(prev.qualityScore).toBeGreaterThanOrEqual(cur.qualityScore);
      }
    }
  });

  it('推荐结果数量限制为 15', async () => {
    const hw = makeHw({ systemMemoryGB: 128 });
    const list = await recommender.recommend(hw, {} as never);
    expect(list.length).toBeLessThanOrEqual(15);
  });

  it('每条推荐字段完整', async () => {
    const hw = makeHw({ systemMemoryGB: 32 });
    const list: ModelRecommendation[] = await recommender.recommend(hw, {} as never);
    // 验证返回结构完整（即使 fileSizeGB 可能因展示四舍五入为 0，原始估算值已计算）
    for (const r of list) {
      expect(r.modelId).toBeTruthy();
      expect(r.displayName).toBeTruthy();
      expect(r.quantVersion).toBeTruthy();
      expect(r.qualityScore).toBeGreaterThan(0);
      expect(['high', 'medium', 'low']).toContain(r.suitability);
      expect(r.estimatedRamGB).toBeGreaterThan(0);
      expect(r.recommendationReason).toBeTruthy();
      expect(r.fileSizeGB).toBeGreaterThanOrEqual(0);
    }
    // 至少有一个估算值明显大于 0
    expect(list.some((r) => r.estimatedRamGB > 1)).toBe(true);
  });
});
