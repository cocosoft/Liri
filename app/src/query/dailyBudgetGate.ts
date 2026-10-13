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
// USD-4：功能开关（`USD_BUDGET_GATE`，默认关）+ 双读对照日志
import { feature } from '@modules/core';
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
 * **Token 轨**（既有）：`allowed = 有效 waiver || (mode !== 'locked' && (projectedUsed + estimatedTokens) < dailyLimit)`。
 *
 * - 与既有 `preSendContextProtection` 的内联判定**互补等价**：
 *   原拒绝条件 = `mode === 'locked' || (projected + estimate) >= limit`。
 * - **不做预扣**：预扣（`reserveFor`）仍由调用方负责；本函数可被工具循环**逐轮**安全调用。
 * - `waive-once` 通行证（C2）⇒ `allowed` 短路口（越界也放行**本轮**）；**不消费**通行证。
 *
 * **金额轨（USD-4，方案 §6.3/§6.4「双轨从严」）**：启用条件 = `FEATURE_USD_BUDGET_GATE` 开
 * **且** 用户已配置 `limitUsd`（代码内**无任何默认值** ⇒ 未配置即不启用）。启用时
 * `金额已越界 OR Token 轨已越界` ⇒ **拒发**（同一 `DAILY_BUDGET_EXCEEDED` 路径）。
 *
 * - **不新增账本**：金额轨只**读** S5/S8 既有 `usedUsd` / `limitUsd`；不新增锁/事务。
 * - **不新增第二个闸门**：判定仍在本**唯一收口**内（D7）。
 * - **金额轨无"本轮预估"**（金额来自结算侧 S8，判定侧是同步纯读 ⇒ 两条口径时间线不同）⇒
 *   金额轨按**已结算** `usedUsd` 判定；「预扣→结算」窗口由 Token 轨的**同步预扣**闭合（§6.4-2）。
 * - **归因**：仅当**金额轨独占拒绝**（Token 轨放行）时快照 `unit === 'usd'`；两轨同时越界 ⇒
 *   归因 Token（用户文案与历史一致），两轨明细见双读对照日志。
 */
export function checkDailyBudget(input: {
  sessionId: string;
  estimatedTokens: number;
}): { allowed: boolean; snapshot: BudgetSnapshot } {
  const budget = getDailyBudget();
  // ⚠️ 顺序敏感：`getMode()` 内含 `_rolloverIfNeeded()`（跨日归零 / 欠账扣回）⇒
  // 必须在读 `getUsdState()` **之前**，否则金额轨会看到昨日的 `usedUsd`。
  const state = budget.getMode();
  const projected = state.projectedUsed + input.estimatedTokens;
  // C2（最终整支评审）：`waive-once` 放行必须接到本**唯一收口** —— 否则流式/发送侧闸门只读
  // `mode`（`locked`）⇒ 放行后被唤醒的会话立刻再 `locked`（撞反目标②"放行无反应"）。
  // `hasActiveWaiver()` 为**只读**判据（消费点仍在 `recordUsage()`）⇒ 本函数保持**无副作用**。
  const tokenAllowed =
    budget.hasActiveWaiver() ||
    (state.mode !== 'locked' && projected < state.dailyLimit);

  // ── USD-4：金额轨（开关开 **且** 用户已配置上限才启用；否则恒为 `null` ⇒ 完全不参与判定）──
  const usd = budget.getUsdState();
  const usdTrack =
    feature('USD_BUDGET_GATE') && usd.limitUsd !== undefined
      ? { used: usd.usedUsd, limit: usd.limitUsd }
      : null;
  const usdExceeded = usdTrack !== null && usdTrack.used >= usdTrack.limit;
  const allowed = tokenAllowed && !usdExceeded;
  const usdGoverns = usdExceeded && tokenAllowed;

  if (usdTrack !== null) {
    // §6.4「双读对照日志」：两轨并排如实记录（灰度期核对"金额轨是否真的在拦"）。
    logger.info('dailyBudgetGate:dual-track', {
      sessionId: input.sessionId,
      tokens: {
        projected,
        dailyLimit: state.dailyLimit,
        mode: state.mode,
        exceeded: !tokenAllowed,
      },
      usd: {
        usedUsd: usdTrack.used,
        limitUsd: usdTrack.limit,
        exceeded: usdExceeded,
      },
      allowed,
      deniedBy: allowed ? null : usdGoverns ? 'usd' : 'tokens',
    });
  }

  const snapshot: BudgetSnapshot =
    usdGoverns && usdTrack !== null
      ? {
          used: usdTrack.used,
          limit: usdTrack.limit,
          unit: 'usd',
          formatted: formatBudget(usdTrack.used, 'usd'),
          mode: state.mode,
        }
      : {
          used: state.todayUsed,
          limit: state.dailyLimit,
          unit: 'tokens',
          formatted: formatBudget(state.todayUsed, 'tokens'),
          mode: state.mode,
        };

  return { allowed, snapshot };
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
