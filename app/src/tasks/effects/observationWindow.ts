// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * P38 观察期判定（2026-11-10）
 *
 * 为什么独立成模块：观察期结论由"覆盖天数 + 样本量"共同决定 —— 只看差异率会把
 * 1 个样本的 0% 当成结论。判定是纯函数，放 `src` 便于脚本（`reply-shadow:rate`）
 * 与单测共用（脚本自身依赖 `bun:sqlite`，测试不应把它拖进类型检查面）。
 */

/** 观察期最短覆盖天数（一周） */
export const OBSERVE_MIN_DAYS = 7;
/** 观察期最小样本量（低于此值差异率没有统计意义） */
export const OBSERVE_MIN_SAMPLES = 30;

export interface ObservationJudgement {
  status: 'not_started' | 'in_progress' | 'judgeable';
  reason: string;
}

/**
 * 观察期判定：样本 ≥ `minSamples` 且覆盖 ≥ `minDays` 天 ⇒ 可判定。
 *
 * 差异率本身**不**自动判通过 —— 有分叉必须逐条解释（由取数脚本输出）。
 */
export function judgeObservationPeriod(input: {
  samples: number;
  days: number;
  minDays?: number;
  minSamples?: number;
}): ObservationJudgement {
  const minDays = input.minDays ?? OBSERVE_MIN_DAYS;
  const minSamples = input.minSamples ?? OBSERVE_MIN_SAMPLES;
  const samples = Number.isFinite(input.samples)
    ? Math.max(0, Math.floor(input.samples))
    : 0;
  const days = Number.isFinite(input.days)
    ? Math.max(0, Math.floor(input.days))
    : 0;
  if (samples === 0) {
    return {
      status: 'not_started',
      reason: '尚无影子样本（等待真实渠道审批回传）',
    };
  }
  if (days >= minDays && samples >= minSamples) {
    return {
      status: 'judgeable',
      reason: `已覆盖 ${days} 天 / ${samples} 样本，可进入判定（分叉需逐条解释）`,
    };
  }
  return {
    status: 'in_progress',
    reason: `进行中：${days}/${minDays} 天 · ${samples}/${minSamples} 样本`,
  };
}
