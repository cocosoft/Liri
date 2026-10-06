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
 * U4 在线质量评估：**权重与阈值**（单一常量表 ⇒ 可单测边界、避免散落魔数）。
 *
 * 规格：`.trae/specs/online-quality-evaluation.md` §3 D1/D2。
 *
 * ⚠️ **这些数值是"初版务实取值"，不是经过标定的统计参数**（无 ground truth 可标定）：
 * - 改动任一数值 ⇒ **必须同步 `EVALUATOR_VERSION`**（消费方据此区分口径）；
 * - `WEIGHTS` 四项之和必须为 `1`（有单测锁定，防止改权重时漏配导致分数整体缩放）。
 */

import type { TurnStatus } from './types.js';

/** 口径版本：**算法/权重任一变更**都必须 bump（分数可演进，但要可区分） */
export const EVALUATOR_VERSION = 'v1';

/** 合成分量权重（**和必须为 1**，有单测） */
export const WEIGHTS = {
  completion: 0.4,
  verdict: 0.3,
  toolThrash: 0.15,
  cost: 0.15,
} as const satisfies Record<string, number>;

/** 完成度分量取值（`running` 不评 ⇒ 不在此表，`scoreTurn` 直接返回 `null`） */
export const COMPLETION_SCORE: Record<
  Exclude<TurnStatus, 'running'>,
  number
> = {
  completed: 1,
  /** 用户主动中断**不等于**模型低质 ⇒ 给部分分（避免把"我不想要了"算成差评） */
  aborted: 0.5,
  error: 0,
};

/** 验证器结论分量取值 */
export const VERDICT_SCORE = {
  APPROVE: 1,
  /** 验证器自身异常/无法判定 ⇒ 偏低但不判零（语义 = "不确定"，不等于"错"） */
  ESCALATE: 0.3,
  REJECT: 0,
} as const;

/** 无验证器结论时的**中性**取值（= 区间中点 ⇒ 不加不减） */
export const VERDICT_UNKNOWN = 0.5;

/** 工具调用数：软阈以内不扣分；软→硬 之间线性衰减；达硬阈记 0 */
export const TOOL_CALLS_SOFT_MAX = 25;
export const TOOL_CALLS_HARD_MAX = 80;

/** 耗时软/硬阈（ms） */
export const DURATION_SOFT_MS = 120_000;
export const DURATION_HARD_MS = 600_000;

/** 出参 token 软/硬阈 */
export const OUTPUT_TOKENS_SOFT = 8_000;
export const OUTPUT_TOKENS_HARD = 40_000;

/** 可疑判定：低于此分 ⇒ 可疑（触发 LLM 复核） */
export const SUSPICIOUS_SCORE_THRESHOLD = 0.45;

/**
 * **高价值轮**阈值（消费点 D6 用：梦境取"值得进化的轮次"）。
 *
 * 与可疑阈值同处一张常量表 ⇒ 不存在第二套分数判据（改阈值即改两处口径，无法漂移）。
 */
export const HIGH_VALUE_SCORE_THRESHOLD = 0.8;

/** 可疑判定：连续低分达到此轮数 ⇒ 可疑（同一失败模式复现） */
export const CONSECUTIVE_LOW_SCORE_RUNS = 3;

/**
 * 单次空闲**最多**复核的轮数（成本硬上限）。
 *
 * 超出者**只落启发式分**并标 `reviewSkipped: 'budget'` —— 宁可少评，不可无限调模型
 * （对齐 CS03：不因"想全评"而引入不可控成本）。
 */
export const MAX_REVIEWS_PER_IDLE = 5;
