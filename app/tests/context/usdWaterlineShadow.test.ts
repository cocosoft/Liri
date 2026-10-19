/**
 * G-05 影子观察：剩余 USD 水位判定（纯函数）。
 */
import { describe, expect, test } from 'bun:test';
import { evaluateUsdWaterlineShadow } from '../../src/context/compaction/usdWaterlineShadow';

describe('evaluateUsdWaterlineShadow', () => {
  test('未配置金额上限 ⇒ null（不臆造百分比）', () => {
    expect(evaluateUsdWaterlineShadow(3, null)).toBeNull();
    expect(evaluateUsdWaterlineShadow(3, 0)).toBeNull();
    expect(evaluateUsdWaterlineShadow(3, Number.NaN)).toBeNull();
  });

  test('剩余 21% ⇒ 不触发 20% 规则', () => {
    expect(evaluateUsdWaterlineShadow(79, 100)).toEqual({
      remainingPct: 21,
      wouldTriggerAt20: false,
    });
  });

  test('剩余 15% ⇒ 影子触发；透支归零', () => {
    expect(evaluateUsdWaterlineShadow(85, 100)).toEqual({
      remainingPct: 15,
      wouldTriggerAt20: true,
    });
    expect(evaluateUsdWaterlineShadow(120, 100)).toEqual({
      remainingPct: 0,
      wouldTriggerAt20: true,
    });
  });
});
