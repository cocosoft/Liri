// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

/**
 * U4 在线质量评估：**数据契约**（纯类型，无逻辑）。
 *
 * 规格：`.trae/specs/online-quality-evaluation.md`（§3 D1/D2）；台账 U4。
 *
 * ⚠️ **两条刻意的边界（务必遵守，勿"顺手"扩字段）**：
 * 1. **不消费 `BehaviorMetrics`**（`evals/types.ts` 的 `selfVerificationCount` / `explorationCount` /
 *    `draftingRatio`）—— 该类型有**显式契约「仅观测、不得作为通过/失败判据」**且有**反向锁定测试**
 *    （`app/tests/evals/behaviorMetrics.test.ts` 末例）；同域先例 `tasks/behaviorFeedback.ts` 同样不消费。
 * 2. **不判"正确性"** —— 本仓无 ground truth，故 `score` 是**相对质量分**（完成度/验证结论/代价），
 *    **不是正确率**；对外表述必须带 `evaluatorVersion`，不得当作准确率指标。
 */

/** 轮次终态（与 `agent/AgentTelemetry.TurnMetrics['status']` 同集，**结构化枚举**，禁止字符串匹配） */
export type TurnStatus = 'running' | 'completed' | 'error' | 'aborted';

/** 验证器三态（`query/VerifierAgent` 的 `VerdictType`；此处**本地字面量联合**，避免跨模块类型依赖） */
export type ReviewVerdictType = 'APPROVE' | 'REJECT' | 'ESCALATE';

/** 打分输入（**只含结果/成本类信号**；见文件头边界 1） */
export interface TurnQualitySignals {
  status: TurnStatus;
  /** 本轮工具调用总数 */
  toolCalls: number;
  /** 本轮耗时（ms）；未知则不给 */
  durationMs?: number;
  inputTokens: number;
  outputTokens: number;
  /** 可选：该轮验证器结论（若该轮跑过验证）；缺省 = 未知（分量取中性，不加不减） */
  verdict?: {
    type: ReviewVerdictType;
    confidence: number;
    checkPassRate?: number;
  };
}

/** 合成分量（各 ∈ [0,1]；保留以便解释"为何是这个分"） */
export interface TurnScoreComponents {
  /** 完成度：completed=1 / aborted 部分 / error=0 */
  completion: number;
  /** 验证器结论：APPROVE=1 / ESCALATE 偏低 / REJECT=0 / 未知=中性 */
  verdict: number;
  /** 工具反复度：调用数在软阈内=1，超出后线性衰减（仅惩罚"明显过多"） */
  toolThrash: number;
  /** 代价：时长与出参 token 的软阈衰减 */
  cost: number;
}

/** 打分结果（**相对分**） */
export interface TurnScore {
  /** 0..1（加权和） */
  score: number;
  components: TurnScoreComponents;
  /** 口径版本：分数算法可演进，消费方必须能区分口径 */
  evaluatorVersion: string;
}

/** 可疑原因（**结构化枚举**，供事件载荷与单测断言） */
export type SuspiciousReason =
  | 'not-completed'
  | 'verdict-negative'
  | 'low-score'
  | 'low-score-streak';

/** 可疑判定结果 */
export interface SuspiciousVerdict {
  suspicious: boolean;
  reasons: SuspiciousReason[];
}

/** 可疑判定输入 */
export interface SuspiciousInput {
  signals: TurnQualitySignals;
  score: number;
  /**
   * **含本轮在内**的连续低分轮数（由调用方维护：本轮低分 ⇒ 上一值 + 1，否则归 0；
   * 可用 `nextLowScoreStreak()`）。用**数值**而非"最近几轮标记/标题"等字符串判据（CS02）。
   */
  consecutiveLowScores: number;
}

/** LLM 复核结论（复用 `VerifierAgent` 三态产物的**精简视图**） */
export interface TurnQualityReview {
  verdict: ReviewVerdictType;
  confidence: number;
  checkPassRate?: number;
  reason?: string;
}
