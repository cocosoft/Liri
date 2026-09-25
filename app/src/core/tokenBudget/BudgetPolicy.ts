// MIT License
// Copyright (c) 2026 Liri
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
 * BudgetPolicy —— **统一预算策略层**（P2-10 / spec `.trae/specs/budget-policy-layer.md`）
 *
 * 背景：本仓预算已**分层存在**（上下文阈值 `UNIFIED_THRESHOLDS` / 任务级 `goalBudget` /
 * 子代理摘要 `summaryTrim`），但入口分散、阈值与公式各写各的 ⇒ 没有任何一处能回答
 * "某作用域的预算是多少、为何是这个数"。
 *
 * 本层只做三件事：**契约** + **注册表** + **既有三处的登记**（**登记既有、不重写算法**）：
 * - `context.compression-levels` —— 由 `UNIFIED_THRESHOLDS` **派生**（阈值数值**引用常量**，不复制）；
 * - `goal.limit` —— 任务级触顶判定（原内联于 `goalBudget.chargeGoalUsage`）；
 * - `subagent.summary-chars` —— 子代理摘要字符预算（公式与常量自 `summaryTrim` **迁入**，
 *   **G14 取数口径与夹取区间逐字保留**）。
 *
 * ⚠️ **边界（避免误读）**：本层是**只读评估**（`evaluate` 为纯计算、无 IO、无副作用），
 * **不改变** `TokenBudgetController` / `goalBudget` / `summaryTrim` 的既有判定与副作用
 * （迁移只落 `goalBudget` 的**纯判定**部分、`summaryTrim` 的**委托**）。
 *
 * 不做：万能 `evaluate(scope, input)`（各 scope 输入不同，泛型单入口会退化为 `any`）、
 * 策略可配置、UI、新表、DI。
 */
import { TokenBudgetStatus, UNIFIED_THRESHOLDS } from './TokenBudgetController';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';
import { getLogger } from '../../monitoring/logs/Logger';

const logger = getLogger('tokenBudget:policy');

// 便于消费方一处取用（避免二次转发 import）
export { TokenBudgetStatus, UNIFIED_THRESHOLDS };

/** 预算作用域（本层只登记这三类） */
export type BudgetScope = 'context' | 'goal' | 'subagent';

/** 一次评估结果（**单位由 scope 约定**：`context`/`goal` = tokens，`subagent` = chars） */
export interface BudgetEvaluation {
  scope: BudgetScope;
  /** 预算（`goal` 未设预算时语义为"不限" ⇒ 调用方据 `ratio === undefined` 判定） */
  budget: number;
  /** 用量比 0..1（无法计算 ⇒ `undefined`） */
  ratio?: number;
  /** 状态（沿用既有 `TokenBudgetStatus`，统一口径） */
  status: TokenBudgetStatus;
}

/** 预算策略（`evaluate` 必须是**纯计算** —— 这是本层可被单测的前提） */
export interface BudgetPolicy<I> {
  /** 全局唯一，约定 `<scope>.<what>` */
  id: string;
  scope: BudgetScope;
  description: string;
  evaluate(input: I): BudgetEvaluation;
}

// ==================== 子代理摘要字符预算（自 `summaryTrim` 迁入，单一实现） ====================

/** 摘要硬顶（字符） */
export const SUMMARY_HARD_MAX_CHARS = 24000;
/** 摘要下限（字符）——父上下文未知时的退化值 */
export const SUMMARY_MIN_CHARS = 2000;
/** head 占比：head 75% / tail 25% */
export const SUMMARY_HEAD_RATIO = 0.75;

export interface SummaryBudgetInput {
  /**
   * 父**当前**上下文的 prompt tokens（最后一次 API 调用的取值）。
   * `undefined` = 未知 ⇒ 退化为 {@link SUMMARY_MIN_CHARS}。
   */
  parentPromptTokens?: number;
  /** 模型上下文窗口（tokens，来自 DB 的 `context_window`） */
  contextWindow?: number;
  /** 同批 worker 数（预算需按数量分摊） */
  workerCount: number;
  /** 每 token 约多少字符（缺省 3.5，仅用于字符预算换算） */
  charsPerToken?: number;
}

/** 任务级预算评估输入 */
export interface GoalBudgetInput {
  tokensUsed: number;
  /** 任务级预算（未设 ⇒ 语义为"不限"） */
  tokenBudget?: number;
}

/** 上下文预算评估输入 */
export interface ContextBudgetInput {
  currentTokens: number;
  maxTokens: number;
}

// ==================== 注册表 ====================

const policies = new Map<string, BudgetPolicy<never>>();
const order: string[] = [];

/**
 * 注册一条预算策略。
 *
 * - **同 id + 同 scope ⇒ 跳过**（模块重复加载时不得抛错，同 `registerConfigMigrations` 手法）；
 * - **同 id 不同 scope ⇒ 抛 `AppError`**（真实冲突，fail-closed）。
 */
export function registerBudgetPolicy<I>(policy: BudgetPolicy<I>): void {
  if (!policy.id || !policy.scope) {
    throw new AppError(
      `预算策略缺少必填字段（id / scope）：${JSON.stringify({
        id: policy.id,
        scope: policy.scope,
      })}`,
      ErrorCategory.EXECUTION,
      ErrorSeverity.HIGH,
      '1000'
    );
  }
  const existing = policies.get(policy.id);
  if (existing) {
    if (existing.scope === policy.scope) return; // 幂等：同一实现的重复加载
    throw new AppError(
      `预算策略 id 冲突：${policy.id}（已注册 scope=${existing.scope}，新 scope=${policy.scope}）`,
      ErrorCategory.EXECUTION,
      ErrorSeverity.HIGH,
      '1000'
    );
  }
  policies.set(policy.id, policy as unknown as BudgetPolicy<never>);
  order.push(policy.id);
}

/** 已注册策略（**顺序稳定** = 注册顺序） */
export function listBudgetPolicies(): Array<BudgetPolicy<never>> {
  return order.map((id) => policies.get(id) as BudgetPolicy<never>);
}

/** 按 id 取策略（**未注册 ⇒ 抛 `AppError`**，不静默返回默认值） */
export function getBudgetPolicy<I>(id: string): BudgetPolicy<I> {
  const policy = policies.get(id);
  if (!policy) {
    throw new AppError(
      `未注册的预算策略：${id}`,
      ErrorCategory.EXECUTION,
      ErrorSeverity.HIGH,
      '1000'
    );
  }
  return policy as unknown as BudgetPolicy<I>;
}

/** 清空注册表（**仅测试用**） */
export function resetBudgetPolicies(): void {
  policies.clear();
  order.length = 0;
}

// ==================== 三策略的纯实现 ====================

/**
 * `subagent.summary-chars`：单个 worker 摘要的字符预算。
 *
 * 规则（**G14 口径逐字保留**）：`剩余 = 窗口 − 当前占用` ⇒ `预算 = 剩余 × 50% ÷ workerCount`
 * （换算成字符，缺省 3.5 chars/token），再夹到 [`SUMMARY_MIN_CHARS`, `SUMMARY_HARD_MAX_CHARS`]；
 * 任一项未知 ⇒ 退化下限（**不臆测**）。
 */
export function evaluateSummaryCharBudget(input: SummaryBudgetInput): number {
  const { parentPromptTokens, contextWindow, workerCount } = input;
  const charsPerToken = input.charsPerToken ?? 3.5;

  if (
    typeof parentPromptTokens !== 'number' ||
    typeof contextWindow !== 'number' ||
    !Number.isFinite(parentPromptTokens) ||
    !Number.isFinite(contextWindow) ||
    workerCount <= 0
  ) {
    return SUMMARY_MIN_CHARS;
  }

  const remaining = Math.max(0, contextWindow - parentPromptTokens);
  const perWorkerTokens = (remaining * 0.5) / workerCount;
  const chars = Math.floor(perWorkerTokens * charsPerToken);

  return Math.min(SUMMARY_HARD_MAX_CHARS, Math.max(SUMMARY_MIN_CHARS, chars));
}

/** `goal.limit`：任务级触顶判定（`tokensUsed >= tokenBudget`；未设预算 ⇒ 恒不触顶） */
export function evaluateGoalBudget(input: GoalBudgetInput): BudgetEvaluation {
  const { tokensUsed, tokenBudget } = input;
  const hasBudget = typeof tokenBudget === 'number';
  const exceeded = hasBudget && tokensUsed >= (tokenBudget as number);
  return {
    scope: 'goal',
    budget: hasBudget ? (tokenBudget as number) : Number.POSITIVE_INFINITY,
    ratio: hasBudget && tokenBudget ? tokensUsed / tokenBudget : undefined,
    status: exceeded ? TokenBudgetStatus.EXCEEDED : TokenBudgetStatus.NORMAL,
  };
}

/**
 * `context.compression-levels`：按用量比给出状态。
 *
 * **口径**（阈值**引用** `UNIFIED_THRESHOLDS`，不复制数值；本策略为**只读评估**，
 * 不改变 `TokenBudgetController` 的既有判定）：`ratio ≥ 1 ⇒ EXCEEDED`、
 * `≥ CRITICAL(0.92) ⇒ CRITICAL`、`≥ WARNING(0.75) ⇒ WARNING`、否则 `NORMAL`。
 */
export function evaluateContextBudget(
  input: ContextBudgetInput
): BudgetEvaluation {
  const { currentTokens, maxTokens } = input;
  const ratio = maxTokens > 0 ? currentTokens / maxTokens : undefined;
  let status = TokenBudgetStatus.NORMAL;
  if (ratio !== undefined) {
    if (ratio >= 1) status = TokenBudgetStatus.EXCEEDED;
    else if (ratio >= UNIFIED_THRESHOLDS.CRITICAL)
      status = TokenBudgetStatus.CRITICAL;
    else if (ratio >= UNIFIED_THRESHOLDS.WARNING)
      status = TokenBudgetStatus.WARNING;
  }
  return { scope: 'context', budget: maxTokens, ratio, status };
}

// ==================== 三处登记（模块加载时完成；幂等） ====================

registerBudgetPolicy<ContextBudgetInput>({
  id: 'context.compression-levels',
  scope: 'context',
  description: '上下文用量比 → 预算状态（阈值引用 UNIFIED_THRESHOLDS）',
  evaluate: evaluateContextBudget,
});

registerBudgetPolicy<GoalBudgetInput>({
  id: 'goal.limit',
  scope: 'goal',
  description: '任务级预算触顶判定（tokensUsed >= tokenBudget）',
  evaluate: evaluateGoalBudget,
});

registerBudgetPolicy<SummaryBudgetInput>({
  id: 'subagent.summary-chars',
  scope: 'subagent',
  description: '子代理摘要字符预算（父余量 × 50% ÷ worker 数，夹 2000–24000）',
  evaluate: (input) => ({
    scope: 'subagent',
    budget: evaluateSummaryCharBudget(input),
    status: TokenBudgetStatus.NORMAL,
  }),
});

logger.debug('预算策略层已就绪', { policies: order.slice() });
