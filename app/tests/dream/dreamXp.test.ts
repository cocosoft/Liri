/**
 * 梦境经验公式（2026-11-25 第 3 批）：唯一事实源 `computeDreamXp`。
 *
 * 回归点：SSE `dream:cycle:completed.xp` 与伙伴成长曾各用一套公式
 * （`sessions×10+memories×5+insights×3` vs `sessions×10+insights×5`），
 * 同一个梦在 UI 与伙伴面板显示不同经验。
 */
import { describe, expect, it } from 'bun:test';
import {
  computeDreamXp,
  DREAM_XP_PER_INSIGHT,
  DREAM_XP_PER_SESSION,
} from '@openliri/infra/chronos';

describe('computeDreamXp', () => {
  it('会话×10 + 洞察×5（与伙伴成长同源）', () => {
    expect(DREAM_XP_PER_SESSION).toBe(10);
    expect(DREAM_XP_PER_INSIGHT).toBe(5);
    // 真机样本：1 次完成、14 条洞察 ⇒ 伙伴侧 totalXp 曾显示 70
    expect(computeDreamXp({ sessions: 0, insights: 14 })).toBe(70);
    expect(computeDreamXp({ sessions: 3, insights: 4 })).toBe(50);
  });

  it('非有限值/负数/小数统一收敛（不产生 NaN）', () => {
    expect(computeDreamXp({ sessions: Number.NaN, insights: 4 })).toBe(20);
    expect(
      computeDreamXp({ sessions: 2, insights: Number.POSITIVE_INFINITY })
    ).toBe(20);
    expect(computeDreamXp({ sessions: -5, insights: -3 })).toBe(0);
    expect(computeDreamXp({ sessions: 2.9, insights: 1.7 })).toBe(25);
  });
});
