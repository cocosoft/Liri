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
 * daily-budget-handlers.ts — 日 Token 限额状态查询 / 配置 / 重置 / kill switch（D3）
 *
 * 端点：
 * - `GET    /v1/cost/daily-budget`             当前状态（用量/档位/上限/阈值/kill switch）
 * - `PUT    /v1/cost/daily-budget`             热更新上限/阈值（持久化到 config，运行期即时生效）
 * - `POST   /v1/cost/daily-budget/reset`       重置当日统计（D6；**用量归零**）
 * - `POST   /v1/cost/daily-budget/kill-switch` 手动硬锁开关（D6）
 * - `POST   /v1/cost/daily-budget/relief`      放行（D-b：临时提额 / 单次豁免 / 当日解除）
 * - `DELETE /v1/cost/daily-budget/relief`      **撤销放行**（保留用量，≠ reset）
 *
 * 归属说明：日预算单例在 `query/**`（app 层），本文件属 service 层 ⇒ 按本仓既有
 * `chat-handlers.ts` 的 `await import('@modules/chat')` 模式**动态导入**，避免 service → app
 * 静态倒挂（R00-001）。CLI/REPL 无需本层，前端「日限额」tab 经 HTTP 消费。
 */

import type http from 'http';
import { handleError } from '@modules/error';
import { getLogger } from '@modules/monitoring';
import { setConfigValue } from '@modules/config';
import { readBody, json } from './handler-utils';
// 仅**类型位**（R00-001 口径：type-only 跨层引用不计违规）
import type { DailyBudgetManager } from '@modules/query';

const logger = getLogger('http:dailyBudget');

/** SSE 事件名（前端 useNotificationSSE 订阅后刷新面板） */
export const DAILY_BUDGET_SSE_EVENT = 'cost:dailyBudgetUpdated';

/**
 * 动态取用 `query` 模块（避免 service → app 静态倒挂）。
 *
 * 走**模块桶** `@modules/query`（R03-002：禁止子路径直连），与 `chat-handlers` 的
 * `await import('@modules/chat')` 同构；仅在实际命中端点时才加载该桶。
 */
async function loadQueryModule(): Promise<typeof import('@modules/query')> {
  return import('@modules/query');
}

/** 取进程级日预算单例 */
async function loadBudget(): Promise<DailyBudgetManager> {
  const { getDailyBudget } = await loadQueryModule();
  return getDailyBudget();
}

/** 供前端渲染的日预算快照（把内部状态与生效配置拉平为一个 DTO） */
function budgetSnapshot(budget: DailyBudgetManager): Record<string, unknown> {
  const state = budget.getMode();
  const cfg = budget.getConfigSnapshot();
  return {
    date: budget.currentDate(),
    mode: state.mode,
    todayUsed: state.todayUsed,
    projectedUsed: state.projectedUsed,
    dailyLimit: state.dailyLimit,
    percentUsed: state.percentUsed,
    remaining: state.remaining,
    warningThreshold: cfg.warningThreshold,
    lockThreshold: cfg.lockThreshold,
    killSwitch: budget.isKillSwitchEnabled(),
    // D-b/D-d（2026-10-11）：放行与透支欠账（Spec §5-B / §5-E）
    relief: budget.getRelief(),
    debt: budget.getDebtTokens(),
  };
}

/** 放行请求体（**结构等价**于 `ReliefInput`，避免依赖 query 桶的具名导出）。 */
type ReliefBody =
  | { kind: 'boost'; factor?: number; amount?: number; ttlMs?: number }
  | { kind: 'waive-once'; ttlMs?: number }
  | { kind: 'unlock-today' };

function isPositiveNumber(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n) && n > 0;
}

/**
 * 解析并**严格校验**放行请求（边界纪律 fail-loud：非法 ⇒ `null`，由调用方回 400）。
 *
 * 与既有 PUT 的同款纪律一致：外部输入非法**不得静默忽略**（区别于内部 `applyRelief` 的宽容）。
 */
function parseReliefBody(raw: Record<string, unknown>): ReliefBody | null {
  const kind = raw['kind'];
  const factor = raw['factor'];
  const amount = raw['amount'];
  const ttlMs = raw['ttlMs'];
  if (factor !== undefined && !isPositiveNumber(factor)) return null;
  if (amount !== undefined && !isPositiveNumber(amount)) return null;
  if (ttlMs !== undefined && !isPositiveNumber(ttlMs)) return null;

  if (kind === 'unlock-today') return { kind: 'unlock-today' };
  if (kind === 'waive-once') {
    return ttlMs === undefined
      ? { kind: 'waive-once' }
      : { kind: 'waive-once', ttlMs };
  }
  if (kind === 'boost') {
    return {
      kind: 'boost',
      ...(factor !== undefined ? { factor } : {}),
      ...(amount !== undefined ? { amount } : {}),
      ...(ttlMs !== undefined ? { ttlMs } : {}),
    };
  }
  return null;
}

/**
 * POST /v1/cost/daily-budget/relief — 放行（D-b：临时提额 / 单次豁免 / 当日解除）
 *
 * body: `{ kind: 'boost' | 'waive-once' | 'unlock-today', factor? | amount?, ttlMs? }`
 *
 * **硬锁优先**（D-e）：kill-switch 开启时本端点照常记录放行状态（便于 UI 展示），但
 * `getMode()` 仍为 `locked`（不静默削弱硬锁）。
 */
export async function handleSetDailyBudgetRelief(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  broadcastEvent: (event: string, data: unknown) => void
): Promise<void> {
  try {
    const rawText = await readBody(req);
    let raw: Record<string, unknown>;
    try {
      const parsed = JSON.parse(rawText || '{}') as unknown;
      raw =
        parsed && typeof parsed === 'object'
          ? (parsed as Record<string, unknown>)
          : {};
    } catch {
      // 边界纪律 fail-loud：坏 JSON ⇒ 400（与 PUT 同款）
      json(res, 400, { error: { message: '请求体不是合法 JSON' } });
      return;
    }
    const input = parseReliefBody(raw);
    if (!input) {
      json(res, 400, {
        error: { message: 'relief 参数非法（kind/factor/amount/ttlMs）' },
      });
      return;
    }
    const budget = await loadBudget();
    const relief = budget.applyRelief(input);
    const snapshot = budgetSnapshot(budget);
    broadcastEvent(DAILY_BUDGET_SSE_EVENT, snapshot);
    json(res, 200, { ...snapshot, relief });
  } catch (err) {
    await handleError(err, { module: 'http:dailyBudget', action: 'relief' });
    if (!res.headersSent) {
      json(res, 500, { error: { message: '设置日限额放行失败' } });
    }
  }
}

/**
 * DELETE /v1/cost/daily-budget/relief — **撤销放行**（D-b 的对称回路，2026-10-12）
 *
 * 与 `POST /relief` 对称：清空当前**全部在途放行**（`boost` / `unlock-today` / `waive-once`），
 * 恢复为**配置上限**；**保留**今日用量与欠账 —— 这是与 `POST /reset` 的关键差异
 * （后者把 `todayUsed` 归零 ⇒ 反而变成"解锁"）。
 *
 * 无放行时为**幂等 no-op**（仍回 200 + 快照）。回复 `relief: null`。
 */
export async function handleClearDailyBudgetRelief(
  res: http.ServerResponse,
  broadcastEvent: (event: string, data: unknown) => void
): Promise<void> {
  try {
    const budget = await loadBudget();
    budget.clearRelief();
    const snapshot = budgetSnapshot(budget);
    broadcastEvent(DAILY_BUDGET_SSE_EVENT, snapshot);
    json(res, 200, { ...snapshot, relief: null });
  } catch (err) {
    await handleError(err, {
      module: 'http:dailyBudget',
      action: 'relief-revoke',
    });
    if (!res.headersSent) {
      json(res, 500, { error: { message: '撤销日限额放行失败' } });
    }
  }
}

/**
 * GET /v1/cost/daily-budget — 查询当前日 Token 预算状态
 */
export async function handleGetDailyBudget(
  res: http.ServerResponse
): Promise<void> {
  try {
    const budget = await loadBudget();
    json(res, 200, budgetSnapshot(budget));
  } catch (err) {
    await handleError(err, { module: 'http:dailyBudget', action: 'get' });
    if (!res.headersSent) {
      json(res, 500, { error: { message: '获取日限额状态失败' } });
    }
  }
}

/**
 * PUT /v1/cost/daily-budget — 热更新上限/阈值
 *
 * body: `{ dailyLimit?, warningThreshold?, lockThreshold? }`（至少一项）
 *
 * 边界纪律（fail loud）：外部输入非法 ⇒ 400，**禁止**静默忽略（区别于内部 `applyConfig` 的宽容）。
 * 校验通过与内部同一口径（复用 `isValidDailyLimit` / `isValidBudgetRatio`）。
 */
export async function handleUpdateDailyBudget(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  broadcastEvent: (event: string, data: unknown) => void
): Promise<void> {
  try {
    let body: Record<string, unknown>;
    try {
      const raw = await readBody(req);
      body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    } catch {
      json(res, 400, { error: { message: '无效的 JSON 请求体' } });
      return;
    }

    const { isValidDailyLimit, isValidBudgetRatio, DAILY_BUDGET_CONFIG_KEY } =
      await loadQueryModule();

    const { dailyLimit, warningThreshold, lockThreshold } = body;
    if (
      dailyLimit === undefined &&
      warningThreshold === undefined &&
      lockThreshold === undefined
    ) {
      json(res, 400, {
        error: {
          message:
            '至少提供 dailyLimit / warningThreshold / lockThreshold 之一',
        },
      });
      return;
    }
    if (dailyLimit !== undefined && !isValidDailyLimit(dailyLimit)) {
      json(res, 400, { error: { message: 'dailyLimit 必须为正整数' } });
      return;
    }
    if (
      warningThreshold !== undefined &&
      !isValidBudgetRatio(warningThreshold)
    ) {
      json(res, 400, {
        error: { message: 'warningThreshold 必须为 (0, 1] 的比值' },
      });
      return;
    }
    if (lockThreshold !== undefined && !isValidBudgetRatio(lockThreshold)) {
      json(res, 400, {
        error: { message: 'lockThreshold 必须为 (0, 1] 的比值' },
      });
      return;
    }

    const budget = await loadBudget();
    budget.applyConfig({
      ...(dailyLimit !== undefined ? { dailyLimit } : {}),
      ...(warningThreshold !== undefined ? { warningThreshold } : {}),
      ...(lockThreshold !== undefined ? { lockThreshold } : {}),
    });

    // 持久化**合并后的生效配置**（避免只传一项时抹掉其余字段）⇒ 重启后仍生效（D1）。
    const cfg = budget.getConfigSnapshot();
    setConfigValue(DAILY_BUDGET_CONFIG_KEY, {
      dailyLimit: cfg.dailyLimit,
      warningThreshold: cfg.warningThreshold,
      lockThreshold: cfg.lockThreshold,
    });
    logger.info('日 Token 预算配置已更新', {
      dailyLimit: cfg.dailyLimit,
      warningThreshold: cfg.warningThreshold,
      lockThreshold: cfg.lockThreshold,
    });

    const snapshot = budgetSnapshot(budget);
    broadcastEvent(DAILY_BUDGET_SSE_EVENT, snapshot);
    json(res, 200, snapshot);
  } catch (err) {
    await handleError(err, { module: 'http:dailyBudget', action: 'update' });
    if (!res.headersSent) {
      json(res, 500, { error: { message: '更新日限额失败' } });
    }
  }
}

/**
 * POST /v1/cost/daily-budget/reset — 重置当日统计（用量归零 + 落盘，D6）
 */
export async function handleResetDailyBudget(
  res: http.ServerResponse,
  broadcastEvent: (event: string, data: unknown) => void
): Promise<void> {
  try {
    const budget = await loadBudget();
    budget.reset();
    logger.info('日 Token 预算已重置');
    const snapshot = budgetSnapshot(budget);
    broadcastEvent(DAILY_BUDGET_SSE_EVENT, snapshot);
    json(res, 200, snapshot);
  } catch (err) {
    await handleError(err, { module: 'http:dailyBudget', action: 'reset' });
    if (!res.headersSent) {
      json(res, 500, { error: { message: '重置日限额失败' } });
    }
  }
}

/**
 * POST /v1/cost/daily-budget/kill-switch — 手动硬锁开关（D6）
 *
 * body: `{ enabled: boolean }` —— true 立即锁定（拒绝后续模型调用）；false 解除。
 */
export async function handleSetDailyBudgetKillSwitch(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  broadcastEvent: (event: string, data: unknown) => void
): Promise<void> {
  try {
    let body: Record<string, unknown>;
    try {
      const raw = await readBody(req);
      body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    } catch {
      json(res, 400, { error: { message: '无效的 JSON 请求体' } });
      return;
    }
    if (typeof body.enabled !== 'boolean') {
      json(res, 400, { error: { message: 'enabled 必须为布尔值' } });
      return;
    }

    const budget = await loadBudget();
    if (body.enabled) {
      budget.enableKillSwitch();
    } else {
      budget.disableKillSwitch();
    }
    logger.info('日 Token 预算 kill switch 已切换', { enabled: body.enabled });

    const snapshot = budgetSnapshot(budget);
    broadcastEvent(DAILY_BUDGET_SSE_EVENT, snapshot);
    json(res, 200, snapshot);
  } catch (err) {
    await handleError(err, {
      module: 'http:dailyBudget',
      action: 'killSwitch',
    });
    if (!res.headersSent) {
      json(res, 500, { error: { message: '切换 kill switch 失败' } });
    }
  }
}
