/**
 * 修复回归（2026-11-25）：梦后记忆回写结果必须回填周期统计。
 *
 * 原实现 `memoriesCreated/memoriesRefined` 声明后从未自增，且 `runMemoryDream` 返回值被丢弃
 * ⇒ 前端梦境日志 / analytics / 伙伴 XP 的记忆项恒 0。
 */
import { describe, expect, it } from 'bun:test';
import { mapMemoryDreamStats } from '@modules/dream/UnifiedDreamCycle';

describe('mapMemoryDreamStats', () => {
  it('created ← knowledgeSynced，refined ← refinedCount', () => {
    expect(
      mapMemoryDreamStats({ refinedCount: 3, knowledgeSynced: 2 })
    ).toEqual({ created: 2, refined: 3 });
  });

  it('异常数值收敛为非负整数（不产生 NaN/负数统计）', () => {
    expect(
      mapMemoryDreamStats({ refinedCount: Number.NaN, knowledgeSynced: -1 })
    ).toEqual({ created: 0, refined: 0 });
    expect(
      mapMemoryDreamStats({ refinedCount: 2.9, knowledgeSynced: 1.2 })
    ).toEqual({ created: 1, refined: 2 });
  });
});
