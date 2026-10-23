/**
 * 压缩升级判据（2026-10-21，外部建议 §三）· 纯函数 + 开关默认值回归
 *
 * 锁四件事：
 *  ① 双条件成立（剩余 ≤20% **且** 熵 >30%）⇒ 升级；
 *  ② 边界：剩余 =20% 升级、21% 不升级；熵 =30% 不升级、30.1% 升级；
 *  ③ 任一信号缺失 / 非有限 ⇒ 不升级（不臆造）；
 *  ④ 开关默认**关**（与 G-05 取证一致）。
 */
import { describe, it, expect } from 'bun:test';

import { shouldEscalateCompaction } from '../../src/context/compaction/compactionEscalation';
import { FEATURE_FLAGS } from '@openliri/kernel/featureFlags';
import {
  getLastSchemaEntropyPercent,
  recordToolSchemaEntropy,
  resetLastSchemaEntropyPercentForTest,
} from '../../src/tools/monitoring/ToolMetrics';

const ENTROPY_THRESHOLD = 30;

function decide(remainingPct: number | null, entropyPercent: number | null) {
  return shouldEscalateCompaction({
    remainingPct,
    entropyPercent,
    entropyThresholdPct: ENTROPY_THRESHOLD,
  });
}

describe('shouldEscalateCompaction：联立判定', () => {
  it('剩余 15% 且熵 35% ⇒ 升级并带理由', () => {
    const r = decide(15, 35);
    expect(r.escalate).toBe(true);
    expect(r.reason).toContain('激进裁剪');
  });

  it('边界：剩余 =20% ⇒ 升级；21% ⇒ 不升级', () => {
    expect(decide(20, 35).escalate).toBe(true);
    expect(decide(21, 35).escalate).toBe(false);
  });

  it('边界：熵 =30% ⇒ 不升级；30.1% ⇒ 升级', () => {
    expect(decide(10, 30).escalate).toBe(false);
    expect(decide(10, 30.1).escalate).toBe(true);
  });

  it('未配置金额上限（remainingPct=null）⇒ 不升级', () => {
    expect(decide(null, 99).escalate).toBe(false);
  });

  it('尚无熵观测（entropyPercent=null）⇒ 不升级', () => {
    expect(decide(5, null).escalate).toBe(false);
  });

  it('非有限值 ⇒ 不升级（NaN 比较不靠隐式语义）', () => {
    expect(decide(Number.NaN, 99).escalate).toBe(false);
    expect(decide(5, Number.NaN).escalate).toBe(false);
    expect(decide(5, Number.POSITIVE_INFINITY).escalate).toBe(false);
  });
});

describe('开关默认值', () => {
  it('CONTEXT_COMPACTION_ESCALATION 默认关闭（G-05：低水位样本不足）', () => {
    expect(FEATURE_FLAGS.CONTEXT_COMPACTION_ESCALATION).toBe(false);
  });
});

describe('ToolMetrics：最近一次 Schema 熵可读', () => {
  it('记录后可读到同一口径的百分比；复位后为 null', () => {
    resetLastSchemaEntropyPercentForTest();
    expect(getLastSchemaEntropyPercent()).toBeNull();

    recordToolSchemaEntropy({
      schemaTokens: 350,
      contextWindowTokens: 1000,
      toolCount: 7,
      turn: 25,
    });
    expect(getLastSchemaEntropyPercent()).toBeCloseTo(35, 5);

    resetLastSchemaEntropyPercentForTest();
    expect(getLastSchemaEntropyPercent()).toBeNull();
  });
});
