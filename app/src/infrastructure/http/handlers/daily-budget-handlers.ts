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
 * - `GET    /v1/cost/daily-budget`             当前状态（用量/档位/上限/阈值/kill switch + USD 只读字段）
 * - `PUT    /v1/cost/daily-budget`             热更新上限/阈值/USD 上限（持久化到 config，运行期即时生效）
 * - `POST   /v1/cost/daily-budget/reset`       重置当日统计（D6；**用量归零**）
 * - `POST   /v1/cost/daily-budget/kill-switch` 手动硬锁开关（D6）
 * - `POST   /v1/cost/daily-budget/relief`      放行（D-b：临时提额 / 单次豁免 / 当日解除）
 * - `DELETE /v1/cost/daily-budget/relief`      **撤销放行**（保留用量，≠ reset）
 * - `GET    /v1/cost/daily-budget/suspend`     **只读**挂起清单（预算挂起续跑可见性，A2）
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
  const usd = budget.getUsdState();
  return {
    date: budget.currentDate(),
    mode: state.mode,
    /**
     * 债四 **S3**（2026-10-15）：`unit` = **主口径**（`'usd'` ⇔ USD 闸门启用）。
     * 其下的 `used` / `dailyLimit` / `percentUsed` / `remaining` **均为主口径值**；
     * `todayUsed` 恒为 **Token 口径**（辅助系数，供参考展示），前端须按 `unit` 分别格式化。
     */
    unit: state.unit,
    /** 主口径已用量（`'usd'` ⇒ 已结算金额；`'tokens'` ⇒ 当日 Token） */
    used: state.used,
    todayUsed: state.todayUsed,
    /**
     * **Token 轨基数上限**（配置键 `costControl.dailyTokenBudget`）—— 恒为 Token 口径，
     * 供"观测行"展示（`todayUsed / tokenLimit`）。主口径为 USD 时它与 `dailyLimit` **不同源**。
     */
    tokenLimit: cfg.dailyLimit,
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
    // 债四 S5 / 方案 §6.3 **USD-1**（2026-10-13）：USD 口径**只读**暴露。
    // `limitUsd` 未配置 ⇒ **显式 `null`**：**不臆造 `0`**（`0` 会被误读为"上限=0 ⇒ 全额拒发"），
    // 也让前端无需区分"字段缺席 / null"两种"未配置"形态。
    usedUsd: usd.usedUsd,
    debtUsd: usd.debtUsd,
    limitUsd: usd.limitUsd ?? null,
  };
}

/** 放行请求体（**结构等价**于 `ReliefInput`，避免依赖 query 桶的具名导出）。 */
type ReliefBody = (
  | { kind: 'boost'; factor?: number; amount?: number; ttlMs?: number }
  | { kind: 'waive-once'; ttlMs?: number }
  | { kind: 'unlock-today' }
) & {
  /**
   * **可选：唤醒收窄目标**（2026-10-17 用户裁定，见 spec D5 增补）。
   *
   * 只把本次放行的**唤醒范围**收窄到该会话 —— 额度仍是**当日全局**（日预算是共享资源，
   * 无法按会话提额）。供**会话级**入口（前端挂起卡片的「继续」）使用，避免"在某会话点继续
   * ⇒ 当日别的挂起会话也自行开跑并花钱"（真机 E2E 实证）。缺省 ⇒ 既有全局口径（零行为变更）。
   */
  sessionId?: string;
};

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
  const rawSessionId = raw['sessionId'];
  if (factor !== undefined && !isPositiveNumber(factor)) return null;
  if (amount !== undefined && !isPositiveNumber(amount)) return null;
  if (ttlMs !== undefined && !isPositiveNumber(ttlMs)) return null;
  // `sessionId` 给了就**必须**是非空字符串：空串/非字符串 ⇒ 400（不静默降级成"全局唤醒"
  // —— 那样用户以为只续跑本会话，实际把别人的会话也叫醒了）。
  const targetSessionId =
    rawSessionId === undefined
      ? undefined
      : typeof rawSessionId === 'string' && rawSessionId.trim() !== ''
        ? rawSessionId
        : null;
  if (targetSessionId === null) return null;
  const scope =
    targetSessionId === undefined ? {} : { sessionId: targetSessionId };

  if (kind === 'unlock-today') return { kind: 'unlock-today', ...scope };
  if (kind === 'waive-once') {
    return ttlMs === undefined
      ? { kind: 'waive-once', ...scope }
      : { kind: 'waive-once', ttlMs, ...scope };
  }
  if (kind === 'boost') {
    return {
      kind: 'boost',
      ...(factor !== undefined ? { factor } : {}),
      ...(amount !== undefined ? { amount } : {}),
      ...(ttlMs !== undefined ? { ttlMs } : {}),
      ...scope,
    };
  }
  return null;
}

/**
 * POST /v1/cost/daily-budget/relief — 放行（D-b：临时提额 / 单次豁免 / 当日解除）
 *
 * body: `{ kind: 'boost' | 'waive-once' | 'unlock-today', factor? | amount?, ttlMs?, sessionId? }`
 *
 * `sessionId`（可选）：把**唤醒范围**收窄到该会话（额度仍当日全局）；缺省 ⇒ 全局唤醒。
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
        error: {
          message: 'relief 参数非法（kind/factor/amount/ttlMs/sessionId）',
        },
      });
      return;
    }
    // `sessionId` 是**唤醒范围**而非额度语义 ⇒ 拆出来单独传（`applyRelief` 的入参保持
    // "额度定义"的纯净：`ReliefInput` 不含跨域字段）。
    const { sessionId: targetSessionId, ...reliefInput } = input;
    const budget = await loadBudget();
    const relief = budget.applyRelief(reliefInput, targetSessionId);
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
 * GET /v1/cost/daily-budget/suspend — **只读**挂起清单（A2，spec §6.5 可见性）。
 *
 * 暴露 `BudgetSuspendCoordinator.list()`：`expired` 由协调器按 `SUSPEND_TTL_MS`(24h) 现算
 * （**不复制判据**）；无挂起时返回空数组 ⇒ 自然零影响。
 *
 * **不受 `FEATURE_BUDGET_SUSPEND_RESUME` 门控**：协调器只在开关开时才会登记挂起，关时清单恒空；
 * 保持可查便于运维观测（挂起可见性不依赖该开关）。
 */
export async function handleGetDailyBudgetSuspends(
  res: http.ServerResponse
): Promise<void> {
  try {
    const { getBudgetSuspendCoordinator } = await loadQueryModule();
    const sessions = getBudgetSuspendCoordinator()
      .list()
      .map((e) => ({
        sessionId: e.sessionId,
        chain: e.chain,
        suspendedAt: e.suspendedAt,
        reason: e.reason,
        // T3-12（2026-10-13）：如实带出挂起类别（`'budget'` 缺省 / `'guard'`）——
        // **仅新增字段**，不改既有字段语义（既有契约测试零破坏）。
        kind: e.kind ?? 'budget',
        expired: e.expired,
        checkpointRef: e.checkpointRef ?? null,
      }));
    json(res, 200, { sessions, count: sessions.length });
  } catch (err) {
    await handleError(err, {
      module: 'http:dailyBudget',
      action: 'suspend-list',
    });
    if (!res.headersSent) {
      json(res, 500, { error: { message: '获取挂起清单失败' } });
    }
  }
}

/**
 * PUT /v1/cost/daily-budget — 热更新上限/阈值
 *
 * body: `{ dailyLimit?, warningThreshold?, lockThreshold?, dailyLimitUSD? }`（至少一项）
 *
 * `dailyLimitUSD`（债四 USD-2，方案 §6.3）：**正数** ⇒ 设置 USD 口径上限（金额可含小数）；
 * `null` ⇒ **清空 = 解除**（回到"未配置" ⇒ USD 闸门不启用）；缺省 ⇒ 保持现值。
 * **不回填任何默认值**（`§12 Q-U3`：USD 上限由用户自主决策）。
 *
 * 边界纪律（fail loud）：外部输入非法 ⇒ 400，**禁止**静默忽略（区别于内部 `applyConfig` 的宽容）。
 * 校验通过与内部同一口径（复用 `isValidDailyLimit` / `isValidBudgetRatio` / `isValidDailyLimitUsd`）。
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

    const {
      isValidDailyLimit,
      isValidDailyLimitUsd,
      isValidBudgetRatio,
      DAILY_BUDGET_CONFIG_KEY,
      DAILY_BUDGET_USD_CONFIG_KEY,
    } = await loadQueryModule();

    const { dailyLimit, warningThreshold, lockThreshold, dailyLimitUSD } = body;
    if (
      dailyLimit === undefined &&
      warningThreshold === undefined &&
      lockThreshold === undefined &&
      dailyLimitUSD === undefined
    ) {
      json(res, 400, {
        error: {
          message:
            '至少提供 dailyLimit / warningThreshold / lockThreshold / dailyLimitUSD 之一',
        },
      });
      return;
    }
    if (dailyLimit !== undefined && !isValidDailyLimit(dailyLimit)) {
      json(res, 400, { error: { message: 'dailyLimit 必须为正整数' } });
      return;
    }
    // 债四 USD-2（方案 §6.3）：`null` = **显式清空**（解除 USD 上限）；其余非法值 fail-loud。
    let limitUsdPatch: number | null | undefined;
    if (dailyLimitUSD === undefined) {
      limitUsdPatch = undefined; // 缺省 ⇒ 保持现值（不臆造、不回填默认）
    } else if (dailyLimitUSD === null) {
      limitUsdPatch = null; // 清空 ⇒ 解除（回到"未配置"）
    } else if (isValidDailyLimitUsd(dailyLimitUSD)) {
      limitUsdPatch = dailyLimitUSD; // 金额允许小数（与 Token 正整数口径不同）
    } else {
      json(res, 400, {
        error: { message: 'dailyLimitUSD 必须为正数，或传 null 以解除' },
      });
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
    // 债四 USD-2：**仅在显式提供时**改动 USD 上限（缺省 ⇒ 保持现值）
    if (limitUsdPatch !== undefined) {
      budget.setLimitUsd(limitUsdPatch);
    }

    // 持久化**合并后的生效配置**（避免只传一项时抹掉其余字段）⇒ 重启后仍生效（D1）。
    const cfg = budget.getConfigSnapshot();
    setConfigValue(DAILY_BUDGET_CONFIG_KEY, {
      dailyLimit: cfg.dailyLimit,
      warningThreshold: cfg.warningThreshold,
      lockThreshold: cfg.lockThreshold,
    });
    // 债四 USD-2：USD 上限落**独立键**（与 Token 口径**并列、互不替代**）。
    // 清空 ⇒ 写 `null`：ConfigManager **无删除 API**，而解析侧 `typeof null !== 'number'`
    // ⇒ 视同"未配置"（`resolveDailyBudgetConfig()` 的既有口径，无需改解析）。
    if (limitUsdPatch !== undefined) {
      setConfigValue(DAILY_BUDGET_USD_CONFIG_KEY, limitUsdPatch);
    }
    logger.info('日 Token 预算配置已更新', {
      dailyLimit: cfg.dailyLimit,
      warningThreshold: cfg.warningThreshold,
      lockThreshold: cfg.lockThreshold,
      ...(limitUsdPatch !== undefined ? { limitUsd: limitUsdPatch } : {}),
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
