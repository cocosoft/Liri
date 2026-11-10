// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * P38 观察期判定（2026-11-10）：`judgeObservationPeriod` 纯函数。
 *
 * 一周观察必须同时满足"覆盖天数"与"样本量"，只看差异率会把 1 个样本的 0% 误当结论。
 */
import { describe, it, expect } from 'bun:test';
import {
  judgeObservationPeriod,
  OBSERVE_MIN_DAYS,
  OBSERVE_MIN_SAMPLES,
} from '../../src/tasks/effects/observationWindow';

describe('judgeObservationPeriod — 观察期判定', () => {
  it('0 样本 ⇒ not_started（不把"没有数据"当 0% 通过）', () => {
    const j = judgeObservationPeriod({ samples: 0, days: 0 });
    expect(j.status).toBe('not_started');
    expect(j.reason).toContain('尚无影子样本');
  });

  it('有样本但天数不足 ⇒ in_progress', () => {
    const j = judgeObservationPeriod({ samples: OBSERVE_MIN_SAMPLES, days: 3 });
    expect(j.status).toBe('in_progress');
    expect(j.reason).toContain(`3/${OBSERVE_MIN_DAYS}`);
  });

  it('有样本但样本量不足 ⇒ in_progress', () => {
    const j = judgeObservationPeriod({ samples: 2, days: OBSERVE_MIN_DAYS });
    expect(j.status).toBe('in_progress');
    expect(j.reason).toContain(`2/${OBSERVE_MIN_SAMPLES}`);
  });

  it('天数与样本量同时达标 ⇒ judgeable（差异率仍需人工逐条解释分叉）', () => {
    const j = judgeObservationPeriod({
      samples: OBSERVE_MIN_SAMPLES,
      days: OBSERVE_MIN_DAYS,
    });
    expect(j.status).toBe('judgeable');
    expect(j.reason).toContain('可进入判定');
  });

  it('支持自定义阈值；脏值（NaN / 负数 / 小数）归一到非负整数', () => {
    expect(
      judgeObservationPeriod({ samples: 5, days: 2, minDays: 2, minSamples: 5 })
        .status
    ).toBe('judgeable');
    expect(
      judgeObservationPeriod({ samples: Number.NaN, days: Number.NaN }).status
    ).toBe('not_started');
    expect(
      judgeObservationPeriod({ samples: 9.8, days: 7.2 }).reason
    ).toContain('9/');
  });
});
