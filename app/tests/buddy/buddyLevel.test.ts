/**
 * 契约收口 A（2026-11-25）：伙伴等级由累计经验派生。
 *
 * 回归点：等级/经验不再由前端自算（旧实现基于服务端不存在的字段会算出 NaN）；
 * 曲线：第 L 级区间长度 = L × 100（L1 0–100，L2 100–300，L3 300–600 …）。
 */
import { describe, expect, it } from 'bun:test';
import { resolveBuddyLevel, XP_PER_LEVEL_STEP } from '@modules/buddy';

describe('resolveBuddyLevel：累计经验 → 等级视图', () => {
  it('0 经验 = L1 起始', () => {
    expect(resolveBuddyLevel(0)).toEqual({
      level: 1,
      experience: 0,
      experienceToNext: XP_PER_LEVEL_STEP,
    });
  });

  it('阈值边界进级', () => {
    expect(resolveBuddyLevel(99)).toEqual({
      level: 1,
      experience: 99,
      experienceToNext: 100,
    });
    expect(resolveBuddyLevel(100)).toEqual({
      level: 2,
      experience: 0,
      experienceToNext: 200,
    });
    expect(resolveBuddyLevel(299)).toEqual({
      level: 2,
      experience: 199,
      experienceToNext: 200,
    });
    expect(resolveBuddyLevel(300)).toEqual({
      level: 3,
      experience: 0,
      experienceToNext: 300,
    });
  });

  it('非法/负数输入不产生 NaN', () => {
    expect(resolveBuddyLevel(Number.NaN)).toEqual({
      level: 1,
      experience: 0,
      experienceToNext: XP_PER_LEVEL_STEP,
    });
    expect(resolveBuddyLevel(-5)).toEqual({
      level: 1,
      experience: 0,
      experienceToNext: XP_PER_LEVEL_STEP,
    });
  });
});
