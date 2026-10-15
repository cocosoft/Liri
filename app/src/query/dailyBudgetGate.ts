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
 * dailyBudgetGate —— 日预算闸门**唯一收口**（G-1 前置 / Spec `daily-budget-over-limit-ux.md`）。
 *
 * **为什么要有这个模块**：闸门原先内联在 `preSendContextProtection`（仅流式、仅请求开始判定一次）。
 * "超额才拦"的根因是**工具循环每轮不复检** ⇒ 必须有一个**无副作用、可被逐轮调用**的判定入口。
 *
 * **单位无关（Metric-Agnostic，Spec §11）**：对外快照用与单位无关的命名并携带 `unit`/`formatted`，
 * 使后续"以钱（USD）为准"的专项只需替换 `unit`/折算逻辑，而不改判定点与调用方签名。
 */

import { getDailyBudget } from './DailyBudgetManager.js';
import { formatBudget, formatBudgetExhausted } from './dailyBudgetSnapshot.js';
import type { BudgetSnapshot } from './dailyBudgetSnapshot.js';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';
import { getLogger } from '@modules/monitoring';

const logger = getLogger('query:dailyBudgetGate');

// 快照形状与格式化已下沉到**叶子模块**（`dailyBudgetSnapshot`）以避免与状态机形成循环导入；
// 此处仅**再导出**，既有消费方（本模块的导入者）无需改动。
export type { BudgetMode, BudgetSnapshot } from './dailyBudgetSnapshot.js';
export {
  formatBudget,
  formatBudgetExhausted,
  formatUsdAmount,
} from './dailyBudgetSnapshot.js';

// 快照形状与格式化见 `dailyBudgetSnapshot`（叶子模块，本模块再导出）。

/**
 * 判定"本轮能否发起模型调用"（**纯读，无副作用**）。
 *
 * ## 硬闸门（用户 2026-10-15 两次裁定的合成口径）
 *
 * 1. **金额（USD）是唯一预算硬闸门**：USD 轨启用（`FEATURE_USD_BUDGET_GATE` 开 **且** 已配
 *    `limitUsd`）时，档位（`normal` / `report_only` / `locked`）按金额计算，`locked` ⇒ 拒发。
 * 2. **Token 轨只观测、不启用闸门**：Token 计数是"所有请求的上下文搬运总量"（含 `cache_read`、
 *    含 agentic 每轮重发的全上下文）⇒ 与"额度"语义差 1–2 个数量级，**不参与判定**；
 *    越界只经 `_observeTokenTrack` 记 warn。
 * 3. **kill-switch 是手动总闸**：与口径无关，任何情况下拒发，且**不可**被任何放行绕过。
 *
 * ⚠️ 由此产生一处**有意偏离**（如实标注）：`unified-budget-and-accounting.md` §225 原定
 * 「金额上限未设 ⇒ 回落 token 上限（降级可用，不 fail）」—— 本项按用户裁定取消该回落，
 * 即**未配置 `limitUsd` 时不存在任何预算硬闸门**（只有观测告警）。
 *
 * ## 判定式
 *
 * ```
 * allowed = !killSwitch && (waiver || 主口径档位 !== 'locked')
 * ```
 *
 * - `waive-once` 通行证（C2）⇒ 放行**本轮**（不消费，消费仍在 `recordUsage()`）。
 * - `estimatedTokens` 仅进观测日志：**金额轨无"本轮预估"**（按已结算判定），Token 轨又不判定。
 * - **不做预扣**：预扣（`reserveFor`）仍由调用方负责；本函数可被工具循环**逐轮**安全调用。
 */
export function checkDailyBudget(input: {
  sessionId: string;
  estimatedTokens: number;
}): { allowed: boolean; snapshot: BudgetSnapshot } {
  const budget = getDailyBudget();
  // ⚠️ 顺序敏感：`getMode()` 内含 `_rolloverIfNeeded()`（跨日归零 / 欠账扣回）⇒
  // 必须在读 `getUsdState()` **之前**，否则会看到昨日的 `usedUsd`。
  const state = budget.getMode();
  const usd = budget.getUsdState();
  // C2（最终整支评审）：`waive-once` 放行必须接到本**唯一收口**（只读判据）。
  const waiver = budget.hasActiveWaiver();
  // 手动硬锁：**独立于用量**的总闸，任何放行都不得绕过。
  const killSwitch = budget.isKillSwitchEnabled();

  // 硬闸门判据 = **主口径档位**（`_computeState` 仅在 USD 主口径下产出 `locked`；
  // kill-switch 任何口径下都产 `locked`）。Token 口径恒 `normal` ⇒ 天然不拦。
  const primaryAllows = state.mode !== 'locked';
  const allowed = !killSwitch && (waiver || primaryAllows);

  // 观测日志：硬闸门（主口径）+ Token 观测轨并排如实记录，便于核对"两者是否已分离"。
  const tokenBase = budget.getConfigSnapshot().dailyLimit;
  const tokenProjected = state.projectedUsed + input.estimatedTokens;
  logger.info('dailyBudgetGate:decision', {
    sessionId: input.sessionId,
    primary: {
      unit: state.unit,
      used: state.used,
      limit: state.dailyLimit,
      projectedUsed: state.projectedUsed,
      mode: state.mode,
      exceeded: !primaryAllows,
    },
    /** Token 轨**不参与判定**（用户 2026-10-15 裁定）⇒ 本块仅供观测。 */
    tokenTrack: {
      projected: tokenProjected,
      todayUsed: state.todayUsed,
      observationLimit: tokenBase,
      exceeded: tokenBase > 0 && tokenProjected >= tokenBase,
    },
    usd: {
      usedUsd: usd.usedUsd,
      limitUsd: usd.limitUsd ?? null,
    },
    killSwitch,
    waiver,
    allowed,
  });

  // 快照**恒取主口径**（S3：不再"只在拒发时才切金额"）。
  return { allowed, snapshot: budget.getSnapshot() };
}

/**
 * **入口闸门**（G-2 阶段 3 · D-g 的 F/G/K/M）：非 chat 管线对话类入口的"判定 + 出路"统一收口。
 *
 * 各入口的**判定**同为 `checkDailyBudget()`（单一收口）；差别只在**出路载体**
 * （HTTP JSON / 协议任务态 / 流式 error 块 / 终端回显）⇒ 此处只产**载荷**，载体由各入口决定。
 */
export interface EntryBudgetDenial {
  code: 'DAILY_BUDGET_EXCEEDED';
  /** 人读文案（已含"去哪里放行"的指引，可由各载体原样透出） */
  message: string;
  /** 结构化上下文（供 HTTP/协议面拼可操作响应） */
  context: Record<string, unknown>;
}

/**
 * 判定"该入口本轮能否进入模型调用"（**纯函数，不抛**）。
 *
 * @returns `null` ⇒ 放行；否则为带文案与上下文的拒绝载荷
 */
export function resolveEntryBudgetDenial(input: {
  entry: string;
  estimatedTokens: number;
}): EntryBudgetDenial | null {
  const decision = checkDailyBudget({
    sessionId: input.entry,
    estimatedTokens: input.estimatedTokens,
  });
  if (decision.allowed) return null;
  return {
    code: 'DAILY_BUDGET_EXCEEDED',
    message:
      `${formatBudgetExhausted(decision.snapshot)}，为避免超额，本次未调用模型。` +
      '放行方式：在桌面端「用量中心 → 日限额」临时提额 / 今日解除（或调高每日上限）后重试。',
    context: {
      entry: input.entry,
      // S3：口径随快照（USD 轨启用 ⇒ 金额）—— `dailyLimit`/`todayUsed` 均为**主口径**值。
      unit: decision.snapshot.unit,
      todayUsed: decision.snapshot.used,
      dailyLimit: decision.snapshot.limit,
      estimateThisRound: input.estimatedTokens,
    },
  };
}

/** 由拒绝载荷构造业务异常（唯一构造点；调用方可据此 throw 或自行转载体） */
export function createEntryBudgetError(denial: EntryBudgetDenial): AppError {
  return new AppError(
    denial.message,
    ErrorCategory.RESOURCE,
    ErrorSeverity.MEDIUM,
    denial.code,
    denial.context
  );
}

/** 入口闸门的"抛异常"载体：放行即返回，拒绝即抛带真实业务码的 `AppError`。 */
export function assertEntryBudget(input: {
  entry: string;
  estimatedTokens: number;
}): void {
  const denial = resolveEntryBudgetDenial(input);
  if (denial) throw createEntryBudgetError(denial);
}
