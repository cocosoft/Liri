/**
 * G-3（2026-10-18）验证器运行指标（进程内聚合，供诊断与「误拦」复盘）。
 *
 * 记录每次 `VerifierAgent.verify()` 的 verdict 与耗时：
 * - **拒绝率** = REJECT / 总次数；
 * - **升级率** = ESCALATE / 总次数（验证器不可用或不确定）；
 * - **误拦样本**：最近 `MAX_REJECT_SAMPLES` 条 REJECT 的会话 / 轮次 / 反馈摘要。
 *
 * 设计约束：
 * - **进程内、无持久化**：指标是诊断辅助，自身**不驱动**任何业务分支；
 * - **有界**：样本环形缓冲固定上限，避免长会话内存增长；
 * - **零行为影响**：`recordVerifierResult` 只写内存 + 不做 I/O（调用方不必 await）。
 *
 * D5（2026-11-18）：额外把每次结果写入 infra 的「每会话最新结果」只读投影
 * （`@openliri/infra/system/state/verifierLatestResults`），供 A2A「不确定性」产出方读取。
 * 该投影**如实转述**验证器产物、不改判定；消费方由开关 `A2A_UNCERTAINTY_VERIFIER` 默认关闭。
 */

import {
  recordLatestVerifierResult,
  resetLatestVerifierResults,
} from '@openliri/infra/system/state/verifierLatestResults';

/** 误拦（REJECT）样本上限 */
const MAX_REJECT_SAMPLES = 20;

export interface VerifierRejectSample {
  sessionId: string;
  turn: number;
  /** 反馈摘要（截断到 200 字符，避免长文本撑爆指标） */
  feedback: string;
  at: string;
}

export interface VerifierMetricsSnapshot {
  total: number;
  approved: number;
  rejected: number;
  escalated: number;
  /** 拒绝率（0-1；total=0 ⇒ 0） */
  rejectRate: number;
  /** 升级率（0-1；total=0 ⇒ 0） */
  escalateRate: number;
  /** 平均验证耗时（毫秒；total=0 ⇒ 0） */
  avgDurationMs: number;
  /** 最近 REJECT 样本（新 → 旧） */
  rejectSamples: VerifierRejectSample[];
}

interface InternalMetrics {
  total: number;
  approved: number;
  rejected: number;
  escalated: number;
  durationMsTotal: number;
  rejectSamples: VerifierRejectSample[];
}

const metrics: InternalMetrics = {
  total: 0,
  approved: 0,
  rejected: 0,
  escalated: 0,
  durationMsTotal: 0,
  rejectSamples: [],
};

/** 记录一次验证结果（调用方在 `verify()` 返回后立即调用） */
export function recordVerifierResult(input: {
  sessionId: string;
  turn: number;
  verdict: 'APPROVE' | 'REJECT' | 'ESCALATE';
  durationMs: number;
  feedback?: string;
  /** D5：验证器自评置信度（0..1；未提供 ⇒ 不写） */
  confidence?: number;
  /** D5：检查项通过率（0..1；未提供 ⇒ 不写） */
  checkPassRate?: number;
}): void {
  metrics.total++;
  metrics.durationMsTotal += Math.max(0, input.durationMs);

  // D5：最新结果投影**先写**（REJECT 提前 return 也不影响它）
  recordLatestVerifierResult(input.sessionId, {
    verdict: input.verdict,
    turn: input.turn,
    at: Date.now(),
    ...(typeof input.confidence === 'number'
      ? { confidence: input.confidence }
      : {}),
    ...(typeof input.checkPassRate === 'number'
      ? { checkPassRate: input.checkPassRate }
      : {}),
  });

  if (input.verdict === 'APPROVE') {
    metrics.approved++;
    return;
  }
  if (input.verdict === 'ESCALATE') {
    metrics.escalated++;
    return;
  }

  metrics.rejected++;
  metrics.rejectSamples.unshift({
    sessionId: input.sessionId,
    turn: input.turn,
    feedback: (input.feedback ?? '').slice(0, 200),
    at: new Date().toISOString(),
  });
  if (metrics.rejectSamples.length > MAX_REJECT_SAMPLES) {
    metrics.rejectSamples.length = MAX_REJECT_SAMPLES;
  }
}

/** 读取指标快照（返回副本，调用方可安全序列化） */
export function getVerifierMetrics(): VerifierMetricsSnapshot {
  const { total, approved, rejected, escalated, durationMsTotal } = metrics;
  return {
    total,
    approved,
    rejected,
    escalated,
    rejectRate: total > 0 ? rejected / total : 0,
    escalateRate: total > 0 ? escalated / total : 0,
    avgDurationMs: total > 0 ? durationMsTotal / total : 0,
    rejectSamples: metrics.rejectSamples.map((s) => ({ ...s })),
  };
}

/** 重置（测试用；生产不调用） */
export function resetVerifierMetrics(): void {
  metrics.total = 0;
  metrics.approved = 0;
  metrics.rejected = 0;
  metrics.escalated = 0;
  metrics.durationMsTotal = 0;
  metrics.rejectSamples = [];
  resetLatestVerifierResults();
}
