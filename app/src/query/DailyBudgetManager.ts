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
 * DailyBudgetManager — 日预算上限管理
 *
 * Phase 4 新增。对标 loop-engineering-main 的 loop-budget.md。
 * 三级模式：Normal (<80%) → ReportOnly (≥80%) → Locked (≥100% 或 kill switch)
 * Phase 3 增强：收益递减检测、优雅最后一调、持久化恢复。
 */

import { getLogger } from '@modules/monitoring';
import { configManager } from '@modules/config';
import {
  LOOP_MIN_TOKEN_DELTA,
  LOOP_DIMINISH_TURNS_THRESHOLD,
} from './loop-config.js';
// LRO-17：进入 `locked` 时发一次 ALERT，经既有 AlertBridge（订阅 `alert:triggered`）路由，
// 避免长程任务被日限额**静默**腰斩。
import { globalEventBus } from '../core/events/EventBus.js';
// D-k（2026-10-11）：快照形状/格式化取自**叶子模块**（零依赖 ⇒ 不构成与闸门的循环导入）。
import { formatBudget } from './dailyBudgetSnapshot.js';
import type { BudgetSnapshot } from './dailyBudgetSnapshot.js';
// P1：日预算**用量状态**持久化（`{date, used}` 落盘 `~/.pyapp/data/daily-budget-state.json`）。
import {
  loadDailyBudgetState,
  saveDailyBudgetState,
} from './dailyBudgetPersistence.js';
// 预算档位：**单一事实源** = `dailyBudgetSnapshot.ts`（状态机方案 阶段 1.3 取证去重，消除双事实源）
import type { BudgetMode } from './dailyBudgetSnapshot.js';
// 债四「换算接线」（2026-10-13）：单轮用量 + 本轮模型 ⇒ 金额（USD）。
// 换算内核复用 core 零依赖 `calculateTotalCost` + core SPI 取价（S1/S2），本文件只做**编排与入账**。
import { estimateTurnCostUsd } from './modelPricingAdapter.js';

const logger = getLogger('query:dailyBudgetManager');

/** P1：用量落盘去抖窗口（合并热路径多次记账的多次写文件） */
const PERSIST_DEBOUNCE_MS = 1000;

/** relief（放行）种类（Spec `daily-budget-over-limit-ux.md` §4 D-b）。 */
export type ReliefKind = 'boost' | 'waive-once' | 'unlock-today';

/** 放行请求（`POST /v1/cost/daily-budget/relief` 的 body）。 */
export type ReliefInput =
  | { kind: 'boost'; factor?: number; amount?: number; ttlMs?: number }
  | { kind: 'waive-once'; ttlMs?: number }
  | { kind: 'unlock-today' };

/** 对外可见的放行视图（供限额设置面 / 撞限卡片展示）。 */
export interface ReliefView {
  kind: ReliefKind;
  /** 到期时刻（epoch ms）；`null` = 至**日界**（`unlock-today`） */
  expiresAt: number | null;
  /** 当前**有效**上限（relief 生效时为提高后的上限） */
  effectiveLimit: number;
}

/** 内部放行状态（可持久化字段的子集）。 */
interface ReliefState {
  kind: ReliefKind;
  expiresAt: number | null;
  factor?: number;
  amount?: number;
}

/** `boost` 默认倍数（Spec §4 D-n：×2） */
export const DEFAULT_BOOST_FACTOR = 2;
/** `boost` 默认时长（1 小时，到期自动恢复） */
export const DEFAULT_BOOST_TTL_MS = 60 * 60 * 1000;
/** `waive-once` 通行证 TTL（防悬挂：未被消费即作废） */
export const DEFAULT_WAIVE_TTL_MS = 10 * 60 * 1000;
/** `unlock-today` 的**软上限**倍数（Spec §4 D-m：原上限 ×5，防死循环指数级消耗） */
export const UNLOCK_TODAY_SOFT_CAP_FACTOR = 5;

/** D1：日预算运行期配置（上限 + 阈值 + 收益递减） */
export interface DailyBudgetConfig {
  /** 日预算上限（**Token 口径 —— 闸门现行主口径**） */
  dailyLimit: number;
  /**
   * 债四 S5（T3-5/6/7，2026-10-13）：**USD 口径上限**（可选）。
   *
   * ⚠️ **无默认值** —— `§12 Q-U3` 未裁定 ⇒ **不得**以任何数值（含既有先例 `$50/日`）回填。
   * 未配置（`undefined`）即 **USD 闸门不启用**：判定仍走 `dailyLimit` Token 口径，**行为与现状一致**。
   */
  limitUsd?: number;
  /** 警告阈值（百分比），默认 0.8 */
  warningThreshold: number;
  /** 锁定阈值（百分比），默认 1.0 */
  lockThreshold: number;
  /** 收益递减检测的最小 Token 增量，默认 500 */
  minTokenDelta: number;
  /** 连续低增量次数阈值，默认 2 */
  diminishingTurnsThreshold: number;
}

interface DailyBudgetState {
  mode: BudgetMode;
  /** **实际**已用（不含在途预留） */
  todayUsed: number;
  /** **含在途预留**的预计用量（R16 原子预留；无预留时 === `todayUsed`） */
  projectedUsed: number;
  dailyLimit: number;
  percentUsed: number;
  remaining: number;
}

/**
 * 进程级每日 Token 预算**默认上限（单源）**。
 *
 * 2026-10-13 裁定：与类内 `DEFAULT_CONFIG.dailyLimit` **统一为同一常量**（此前两处字面量不一致：
 * 常量 500_000 vs 类内 1_000_000）；按用户裁定**以 1_000_000 为准**。
 * 解析优先级：持久化配置 `costControl.dailyTokenBudget` ＞ env `LIRI_DAILY_BUDGET_TOKENS` ＞ 本常量。
 */
export const DEFAULT_DAILY_BUDGET_TOKENS = 1_000_000;

/** 默认配置 */
const DEFAULT_CONFIG: DailyBudgetConfig = {
  dailyLimit: DEFAULT_DAILY_BUDGET_TOKENS,
  warningThreshold: 0.8,
  lockThreshold: 1.0,
  /** 收益递减 minTokenDelta（可通过 LOOP_MIN_TOKEN_DELTA 环境变量覆盖） */
  minTokenDelta: LOOP_MIN_TOKEN_DELTA,
  /** 收益递减连续轮数阈值（可通过 LOOP_DIMINISH_TURNS_THRESHOLD 环境变量覆盖） */
  diminishingTurnsThreshold: LOOP_DIMINISH_TURNS_THRESHOLD,
};

export class DailyBudgetManager {
  private config: DailyBudgetConfig;
  private todayUsed: number = 0;
  private todayDate: string = '';
  private killSwitch: boolean = false;
  // Phase 3: 收益递减检测
  private lastTotalTokens: number = 0;
  private diminishingTurnsCount: number = 0;
  // Phase 3: 优雅最后一调
  private _graceCallActive: boolean = false;
  /** R16 原子预留：会话级**在途预留**（发送前预扣估算，响应后结算为真实用量） */
  private outstandingBySession = new Map<string, number>();
  /** LRO-17：最近一次**已观测**的预算模式（用于阈值跨越的**单次**日志/告警，避免热路径刷屏） */
  private lastObservedMode: BudgetMode = 'normal';
  /** P1：用量落盘去抖定时器（1s 合并多次记账写） */
  private _persistTimer: ReturnType<typeof setTimeout> | null = null;
  /**
   * P1：用量落盘是否已**激活**。默认关闭 —— 由启动接线 `initDailyBudget()` 开启（"应用已接管
   * 该状态文件"的语义）。未激活时持久化整体不生效，避免临时/测试实例向真实数据目录写盘。
   */
  private _persistenceActive = false;
  /** D-b（2026-10-11）：放行状态（`boost` / `unlock-today`）。`null` = 无放行。 */
  private reliefState: ReliefState | null = null;
  /** D-b：`waive-once` 一次性通行证（Consume-and-Die；未消费则到期作废）。 */
  private waiveOncePending: { expiresAt: number } | null = null;
  /**
   * F4/M1：本轮**取得 `waive-once` 通行证的会话**（`canExecute(sessionId)` 置位、`recordUsage` 末尾消费）。
   * 闸门每轮被多次调用而无现成"轮次边界"可挂消费点 ⇒ 用该标记把"放行"与"消费"对齐到一次记账。
   * `null` = 无放行；**按会话归属**：仅**取得通行证的同一会话**的记账才消费（跨会话不得互相消费）。
   */
  private _waiverGrantedForSession: string | null = null;
  /** D-d：透支欠账（`waive-once` 消耗）——次日计入用量扣回；`reset()` 不抹除。 */
  private debtTokens = 0;
  /**
   * 债四 S5（2026-10-13）：USD 口径**已用**（与 `todayUsed` 并行的第二本账）。
   * **不参与闸门判定**（USD 闸门未启用 ⇒ §12 Q-U3 待裁定）；仅记账 + 落盘 + 只读暴露。
   */
  private usedUsd = 0;
  /** 债四 S5：USD 口径透支欠账（次日由 `_rolloverIfNeeded()` 计入用量扣回；`reset()` 不抹除）。 */
  private debtUsd = 0;
  /** D7（Task 7）：放行应用回调集（进程内唤醒端口；非持久化、非事实源）。 */
  private readonly reliefAppliedListeners = new Set<
    (e: { kind: ReliefKind; effectiveLimit: number }) => void
  >();

  constructor(config?: Partial<DailyBudgetConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * 记录消耗
   *
   * ⚠️ D-j 边界：**仅对话类入口可写**（"有人在场"）；无人看后台（H/I/J/N/O）不得计入
   * —— 见 `recordDailyBudgetFromUsage` 的边界说明与 `tests/budget/sideChannelGuard.test.ts`。
   */
  recordUsage(tokens: number, sessionId?: string): void {
    this._rolloverIfNeeded();
    this.todayUsed += tokens;
    // P1：记账后去抖落盘（重启恢复，避免"重启即清零"绕过日限额）。
    this._schedulePersist();
    // LRO-17：记账后立即观测阈值跨越（本方法在 LRO 非 chat 管线也经
    // `recordDailyBudgetFromUsage` 调用 ⇒ 是"无 getMode 调用"路径的唯一观测点）。
    this._observeModeTransition(this._computeState());
    // F4/M1：仅**取得通行证的同一会话**的记账才消费它（Consume-and-Die）；无 sessionId 或跨会话
    // 的记账**不消费**（未消费者由通行证 TTL 兜底失效）。判据精确相等（CS02）。
    if (sessionId && sessionId === this._waiverGrantedForSession) {
      this._waiverGrantedForSession = null;
      this._consumeWaiverOnce(tokens);
    }
  }

  /**
   * P3：跨**本地**自然日 ⇒ 归零当日用量（幂等）。
   *
   * 原实现只在 `recordUsage` 内做日期比较 ⇒ 若新的一天**先读** `getMode()`（无记账）会看到
   * 昨日用量。本方法在 `recordUsage` 与 `getMode` 双侧调用，保证两侧日界一致。
   * 仅当确实丢弃了旧用量时才落盘（避免"首次只读"产生无意义写）。
   */
  private _rolloverIfNeeded(): void {
    const today = this._getToday();
    if (this.todayDate === today) return;
    // **首次接触**（`todayDate` 为空：未恢复、未记账）只登记日期，**不动**用量/欠账/放行 ——
    // 否则会把刚 `applyRelief` 的放行状态当作"跨日"清掉（T4 回归：unlock-today 被误清）。
    if (this.todayDate === '') {
      this.todayDate = today;
      return;
    }
    // D-d（Spec §4 D-d）：跨日 ⇒ **欠账计入新的一天**（透支扣回），随后清空欠账。
    // D-b（Spec §4 D-n / D-m）：relief 一律**不跨日**（boost 限时、unlock-today 至日界）。
    const carriedDebt = this.debtTokens;
    const carriedDebtUsd = this.debtUsd;
    const hadUsage =
      this.todayUsed > 0 || carriedDebt > 0 || this.reliefState !== null;
    this.todayDate = today;
    this.todayUsed = carriedDebt;
    this.debtTokens = 0;
    // 债四 S5：USD 口径**同法**跨日扣回（与 token 口径对称，两本账各自独立）
    this.usedUsd = carriedDebtUsd;
    this.debtUsd = 0;
    this.reliefState = null;
    this.waiveOncePending = null;
    this._waiverGrantedForSession = null;
    if (hadUsage) this._schedulePersist();
  }

  /** 在途预留合计（R16） */
  private outstandingTotal(): number {
    let sum = 0;
    for (const v of this.outstandingBySession.values()) sum += v;
    return sum;
  }

  /** 预计用量 = **实际** + **在途预留**（R16；在途为 0 时 === `todayUsed`） */
  private effectiveUsed(): number {
    return this.todayUsed + this.outstandingTotal();
  }

  /**
   * **预留（预扣）**（R16 原子预留）：把本会话本轮**估算**计入"在途"，使**并发**的
   * `getMode()` 立刻看到该预留（闭合 check→record 之间的 TOCTOU 窗口）。
   *
   * `ok` 仅表示"含在途仍在限额内"；本层预算当前仍为**建议式**（非硬阻断）⇒ 调用方按需使用。
   */
  reserveFor(
    sessionId: string,
    tokens: number
  ): { ok: boolean; projected: number } {
    if (tokens > 0) {
      this.outstandingBySession.set(
        sessionId,
        (this.outstandingBySession.get(sessionId) ?? 0) + tokens
      );
    }
    const projected = this.effectiveUsed();
    return {
      ok: this.config.dailyLimit <= 0 || projected <= this.config.dailyLimit,
      projected,
    };
  }

  /**
   * **结算（多退少补）**（R16）：清本会话在途预留，并把**真实用量**入账。
   * 无预留时等同 `recordUsage`（例如未经预检的路径）。
   *
   * M1：透传 `sessionId` —— 结算即本会话的记账（chat 主路径唯一写者，
   * `ChatManager.recordChatResponseUsage`）⇒ 本会话取得的 `waive-once` 通行证在此消费。
   */
  settleFor(sessionId: string, actualTokens: number): void {
    this.outstandingBySession.delete(sessionId);
    if (actualTokens > 0) this.recordUsage(actualTokens, sessionId);
  }

  /**
   * 计算当前预算状态（纯计算，无副作用）。
   *
   * R16：`percentUsed` / `mode` / `remaining` 基于**含在途预留**的 `projectedUsed`（在途为 0 时
   * 与 `todayUsed` 相同 ⇒ **无预留则行为逐一不变**）；`todayUsed` 仍为**实际**用量。
   */
  private _computeState(): DailyBudgetState {
    // D-b（2026-10-11）：档位/剩余一律按**有效上限**（relief 生效时为提高后的上限）判定，
    // 使 `boost` / `unlock-today` 真正"放行"而**不是无视预算**（软上限仍在）。
    const limit = this._effectiveLimit();
    const projectedUsed = this.effectiveUsed();
    const percentUsed = limit > 0 ? projectedUsed / limit : 0;

    let mode: BudgetMode = 'normal';

    if (this.killSwitch || percentUsed >= this.config.lockThreshold) {
      mode = 'locked';
    } else if (percentUsed >= this.config.warningThreshold) {
      mode = 'report_only';
    }

    return {
      mode,
      todayUsed: this.todayUsed,
      projectedUsed,
      dailyLimit: limit,
      percentUsed,
      remaining: Math.max(0, limit - projectedUsed),
    };
  }

  /**
   * LRO-17：观测模式**跨越**并各记一次日志（首次进入 `report_only` / `locked`）。
   *
   * 本方法在**热路径**（每次 `getMode`/`recordUsage`）被调用 ⇒ 必须以 `lastObservedMode`
   * 去重，否则刷屏。进入 `locked` 时额外发一次 `[ALERT]`（经 AlertBridge 的 `alert:triggered`）。
   */
  private _observeModeTransition(state: DailyBudgetState): void {
    if (state.mode === this.lastObservedMode) return;
    const previousMode = this.lastObservedMode;
    this.lastObservedMode = state.mode;

    const payload = {
      previousMode,
      mode: state.mode,
      todayUsed: state.todayUsed,
      projectedUsed: state.projectedUsed,
      dailyLimit: state.dailyLimit,
      percentUsed: Math.round(state.percentUsed * 100),
    };

    if (state.mode === 'locked') {
      logger.error('dailyBudget:mode — 日 Token 预算已用尽（locked）', payload);
      globalEventBus.publish('alert:triggered', {
        module: 'query:dailyBudgetManager',
        code: 'DAILY_BUDGET_LOCKED',
        severity: 'HIGH',
        message: `日 Token 预算已用尽（已用 ${state.todayUsed} / 上限 ${state.dailyLimit}），后续模型调用将被拒绝`,
        timestamp: Date.now(),
      });
      return;
    }
    logger.warn(
      'dailyBudget:mode — 日 Token 预算进入告警区（report_only）',
      payload
    );
  }

  // ─── D-b（2026-10-11）：relief（放行）状态机 ─────────────────────────────

  /** 当前**未过期**的 relief（惰性判定：过期即清空 ⇒ 到期自动恢复原上限）。 */
  private _activeRelief(now = Date.now()): ReliefState | null {
    const r = this.reliefState;
    if (!r) return null;
    if (r.expiresAt !== null && now >= r.expiresAt) {
      this.reliefState = null;
      return null;
    }
    return r;
  }

  /**
   * 当前**有效上限**（D-b/D-k）：
   * - 无 relief ⇒ 配置上限（逐一不变）；
   * - `boost` ⇒ `max(×factor, base + amount)`（默认 ×2，Spec §4 D-n）；
   * - `unlock-today` ⇒ 原上限 ×5（**软上限**兜底，Spec §4 D-m）。
   */
  private _effectiveLimit(now = Date.now()): number {
    const base = this.config.dailyLimit;
    const relief = this._activeRelief(now);
    if (!relief) return base;
    if (relief.kind === 'unlock-today') {
      return base * UNLOCK_TODAY_SOFT_CAP_FACTOR;
    }
    if (relief.kind === 'boost') {
      const byFactor = base * (relief.factor ?? DEFAULT_BOOST_FACTOR);
      const byAmount = relief.amount ? base + relief.amount : base;
      return Math.max(base, byFactor, byAmount);
    }
    return base;
  }

  private _reliefView(): ReliefView {
    return {
      kind: this.reliefState?.kind ?? 'boost',
      expiresAt: this.reliefState?.expiresAt ?? null,
      effectiveLimit: this._effectiveLimit(),
    };
  }

  /**
   * 应用一次放行（D-b）。**单一活动 relief**：同 kind 重复 ⇒ 按新参数替换并刷新到期时间；
   * **不写回**配置键（C1：避免污染用户配置，"重启即提额"由持久化的 `expiresAt` 处理）。
   */
  applyRelief(input: ReliefInput): ReliefView {
    const now = Date.now();
    if (input.kind === 'boost') {
      const ttl =
        input.ttlMs && input.ttlMs > 0 ? input.ttlMs : DEFAULT_BOOST_TTL_MS;
      this.reliefState = {
        kind: 'boost',
        expiresAt: now + ttl,
        factor: input.factor,
        amount: input.amount,
      };
      this.waiveOncePending = null;
    } else if (input.kind === 'unlock-today') {
      this.reliefState = { kind: 'unlock-today', expiresAt: null };
      this.waiveOncePending = null;
    } else {
      // `waive-once`：一次性通行证，不改变有效上限（它是"放行本次"而非"提高上限"）
      const ttl =
        input.ttlMs && input.ttlMs > 0 ? input.ttlMs : DEFAULT_WAIVE_TTL_MS;
      this.waiveOncePending = { expiresAt: now + ttl };
    }
    this._schedulePersist();
    this._observeModeTransition(this._computeState());
    // 2026-10-15（可观测性修复）：放行**必须留痕**。
    // 原实现与 `clearRelief()` 不对称 —— 撤销有 `relief_revoked`，**放行侧却静默**：真机
    // `daily-budget-state.json` 出现 `relief.kind="unlock-today"`（放行至日界）而 app.log
    // 对 `relief` 零命中 ⇒ 无法追溯"何时放行了什么"，当日日限额整体不拦截却查无来路。
    const appliedExpiresAt =
      input.kind === 'waive-once'
        ? (this.waiveOncePending?.expiresAt ?? null)
        : (this.reliefState?.expiresAt ?? null);
    logger.info('dailyBudget:relief_applied', {
      kind: input.kind,
      // `unlock-today` ⇒ 至**日界**（null 即"至日界"语义，与 `ReliefView.expiresAt` 一致）
      expiresAt: appliedExpiresAt,
      effectiveLimit: this._effectiveLimit(),
      todayUsed: this.todayUsed,
      usedUsd: this.usedUsd,
    });
    // D7（Task 7）：通知进程内唤醒端口（**仅显式放行成功后**触发 ⇒ 构成因果判别）。
    this._emitReliefApplied(input.kind);
    return this._reliefView();
  }

  /**
   * D7（Task 7）：注册**放行应用回调**，返回解绑函数。
   *
   * 触发时机：`applyRelief(...)` **成功写入放行之后**，`kind` = 本次应用的 kind、
   * `effectiveLimit` = 应用后的有效上限。**仅**在显式放行处触发 —— kill-switch /
   * `reset()` / PUT 配置变更 / `clearRelief()` 一律不触发（它们不改变"用户放行"这一事实）。
   */
  onReliefApplied(
    listener: (e: { kind: ReliefKind; effectiveLimit: number }) => void
  ): () => void {
    this.reliefAppliedListeners.add(listener);
    return () => {
      this.reliefAppliedListeners.delete(listener);
    };
  }

  /** D7：遍历放行回调（`effectiveLimit` 取应用后的有效上限）；回调为 fire-and-forget 端口。 */
  private _emitReliefApplied(kind: ReliefKind): void {
    const effectiveLimit = this._effectiveLimit();
    for (const listener of this.reliefAppliedListeners) {
      listener({ kind, effectiveLimit });
    }
  }

  /** 当前放行视图（`null` = 无放行；过期即视为无）。 */
  getRelief(): ReliefView | null {
    return this._activeRelief() ? this._reliefView() : null;
  }

  /**
   * **撤销放行**（D-b 的对称回路，2026-10-12）。
   *
   * 为什么需要：`applyRelief` 只有"放行"方向、**没有"收回"** —— `reset()` 虽清 `reliefState`，
   * 但同批把 `todayUsed` 归零（⇒ 反而变成解锁），故无法"只收回放行、保留用量"；而 `relief`
   * 现已随状态文件持久化 ⇒ 单纯重启也**不会**清（会被 `restore()` 复原）。
   *
   * 语义：清空**全部在途放行** —— `reliefState`（`boost` / `unlock-today`）与
   * `waiveOncePending`（`waive-once` 一次性通行证）；恢复为**配置上限**。
   * **不动** `todayUsed` / `debtTokens`（≠ `reset()`）。无放行时为**幂等 no-op**。
   *
   * 立即落盘（对齐 `reset()`）：撤销是"止损"动作，去抖窗口内崩溃会让放行复活。
   */
  clearRelief(): void {
    const hadRelief =
      this.reliefState !== null || this.waiveOncePending !== null;
    this.reliefState = null;
    this.waiveOncePending = null;
    this._waiverGrantedForSession = null;
    void this.persistNow();
    if (!hadRelief) return;
    logger.info('dailyBudget:relief_revoked', {
      todayUsed: this.todayUsed,
      dailyLimit: this.config.dailyLimit,
    });
    // 撤销后有效上限回落 ⇒ 模式可能跃迁到 locked（与 applyRelief 同款的观测/告警口径）
    this._observeModeTransition(this._computeState());
  }

  /**
   * `waive-once`：消费一次性通行证（**Consume-and-Die**，C4）。
   *
   * 被该会话（或任一请求）**第一次**认领后立即失活 ⇒ 不会在 TTL 窗口内被反复利用
   * （会话内一次模型交互可派生大量子调用，若窗口内保持开启即被"顺着口子"透支）。
   * 未消费则到期作废（防悬挂）。
   */
  consumeWaiveOnce(sessionId: string): boolean {
    const p = this.waiveOncePending;
    if (!p || Date.now() >= p.expiresAt) {
      this.waiveOncePending = null;
      return false;
    }
    this._consumeWaiverOnce();
    logger.info('dailyBudget:waive_once_consumed', { sessionId });
    return true;
  }

  /**
   * `waive-once` 的**消费体**：使一次性通行证立即失活（Consume-and-Die）。
   *
   * `consumedTokens > 0` 时按**本次实际消耗计入欠账**（`debtTokens`）—— 次日由
   * `_rolloverIfNeeded()` 把欠账**计进新的一天用量**（= 从可用额度扣回，见 §4 D-d / T4）。
   * ⚠️ 2026-10-13 更正：修复前本方法**只清标志、不累加** ⇒ 文档承诺的「计入欠账、次日扣回」
   * 实为**静默 no-op**；显式失效入口（`consumeWaiveOnce`，无金额）仍不计欠账。
   */
  private _consumeWaiverOnce(consumedTokens = 0): void {
    this.waiveOncePending = null;
    if (consumedTokens > 0) this.debtTokens += consumedTokens;
  }

  /**
   * C2（最终整支评审）：是否存在**有效期内、尚未消费**的 `waive-once` 通行证（**只读**）。
   *
   * 为什么需要：F4 只把 `waiveOncePending` 接进了 `canExecute()`（唯一运行时调用者 = `TAORLoop`），
   * 而**流式/发送侧**的闸门是 `query/dailyBudgetGate.checkDailyBudget()` —— 它自述**纯读、无副作用**
   * 且只读 `getMode()` ⇒ `waive-once` 放行后被唤醒的流式会话**立刻再次 `locked`**（撞反目标②
   * "放行无反应"）。本判据把"有效通行证"暴露给该收口，同时**不消费**（消费仍在 `recordUsage()`）。
   *
   * 注：过期即返回 `false`（惰性判定与 `_activeRelief` 同风格）；**不**在此处清空字段，以保"纯读"。
   */
  hasActiveWaiver(now = Date.now()): boolean {
    const p = this.waiveOncePending;
    if (!p) return false;
    return now < p.expiresAt;
  }

  /** D-d：透支欠账（`waive-once` 消耗；次日计入用量扣回）。供 HTTP/面板展示。 */
  getDebtTokens(): number {
    return this.debtTokens;
  }

  /**
   * 债四 S5（2026-10-13）：USD 口径**只读状态**（记账 + 落盘后的对外读数）。
   *
   * `limitUsd` **为 `undefined` 即未配置** ⇒ USD 闸门不启用（`§12 Q-U3` 未裁定，**无默认值**）。
   * 本方法**不参与**任何判定（纯读，无副作用）。
   */
  getUsdState(): {
    usedUsd: number;
    debtUsd: number;
    limitUsd: number | undefined;
  } {
    return {
      usedUsd: this.usedUsd,
      debtUsd: this.debtUsd,
      limitUsd: this.config.limitUsd,
    };
  }

  /**
   * 债四 S5：按**金额**记账（USD 口径；与 `recordUsage` 的 token 口径**并行**）。
   *
   * ⚠️ 边界：与 `recordUsage` 同一"仅对话类入口可写"约定（见 `recordDailyBudgetFromUsage`
   * 的 §2 反目标说明）；`usd <= 0` ⇒ **幂等 no-op**（不落盘、不动日界判定以外的任何状态）。
   * **不消费** `waive-once` 通行证（当前无 USD 闸门 ⇒ 无"放行"语义可对齐）。
   */
  recordUsdUsage(usd: number, sessionId?: string): void {
    if (!Number.isFinite(usd) || usd <= 0) return;
    this._rolloverIfNeeded();
    this.usedUsd += usd;
    this._schedulePersist();
    void sessionId; // 预留会话归属（USD 闸门启用后按会话记账；当前无消费点）
  }

  /** D-k：单位无关快照（供 HTTP / 前端消费；Spec §11）。 */
  getSnapshot(): BudgetSnapshot {
    const state = this._computeState();
    return {
      used: state.todayUsed,
      limit: state.dailyLimit,
      unit: 'tokens',
      formatted: formatBudget(state.todayUsed, 'tokens'),
      mode: state.mode,
    };
  }

  /** D-b/D-d：当前可持久化状态（用量 + 欠账 + 放行）。 */
  private _persistedState() {
    const relief = this._activeRelief();
    return {
      date: this.todayDate || this._getToday(),
      used: this.todayUsed,
      debt: this.debtTokens,
      // 债四 S5：USD 两字段随状态文件往返（与 token 口径并排；**不**由 token 反推）
      usedUsd: this.usedUsd,
      debtUsd: this.debtUsd,
      relief: relief
        ? {
            kind: relief.kind,
            expiresAt: relief.expiresAt,
            factor: relief.factor,
            amount: relief.amount,
          }
        : null,
    };
  }

  /**
   * 获取当前预算模式。
   */
  getMode(): DailyBudgetState {
    this._rolloverIfNeeded(); // P3：读侧同样处理日切
    const state = this._computeState();
    this._observeModeTransition(state);
    return state;
  }

  /**
   * D1：运行时**热更新**配置（上限/阈值等），使前端/API 改动**立即生效**，无需重启。
   *
   * 仅接受合法值（上限为正整数、阈值为 (0,1] 比值），非法值忽略以保留当前值（CS03：不静默回退）。
   * 更新后重新观测档位：如上调上限可使 `locked → report_only`，需立刻反映。
   */
  applyConfig(partial: Partial<DailyBudgetConfig>): void {
    if (isPositiveInt(partial.dailyLimit)) {
      this.config.dailyLimit = partial.dailyLimit;
    }
    if (isRatio(partial.warningThreshold)) {
      this.config.warningThreshold = partial.warningThreshold;
    }
    if (isRatio(partial.lockThreshold)) {
      this.config.lockThreshold = partial.lockThreshold;
    }
    this._observeModeTransition(this._computeState());
  }

  /** D1：便捷设置日上限（等价 `applyConfig({ dailyLimit })`）。 */
  setLimit(limit: number): void {
    this.applyConfig({ dailyLimit: limit });
  }

  /**
   * 债四 USD-2（2026-10-13，方案 §6.3）：**设置 / 解除** USD 口径上限。
   *
   * - 正有限数 ⇒ 设置（金额可含小数）；
   * - `null` ⇒ **解除**（回到"未配置" ⇒ USD 闸门不启用）；
   * - 其它非法值 ⇒ 忽略并保留现值（与 `applyConfig` 同款宽容；外部边界另由
   *   `isValidDailyLimitUsd` 做 fail-loud 400）。
   *
   * **何以不并入 `applyConfig`**：USD 上限**不参与** `getMode()` 的档位计算（USD 闸门在
   * `checkDailyBudget` 内独立判定，见方案 §6.4）⇒ 此处**不**触发档位重观测，避免语义误导。
   */
  setLimitUsd(limitUsd: number | null): void {
    if (limitUsd === null) {
      delete this.config.limitUsd;
      return;
    }
    if (!isValidDailyLimitUsd(limitUsd)) {
      return;
    }
    this.config.limitUsd = limitUsd;
  }

  /** D1：当前生效配置的**浅拷贝**（供 API 回显 / 持久化回写，避免外部改写内部状态）。 */
  getConfigSnapshot(): DailyBudgetConfig {
    return { ...this.config };
  }

  /** 当前预算所属**本地**自然日（YYYY-MM-DD；读侧先处理日切）。 */
  currentDate(): string {
    this._rolloverIfNeeded();
    return this.todayDate;
  }

  /** kill switch 是否已启用（手动硬锁，独立于用量阈值）。 */
  isKillSwitchEnabled(): boolean {
    return this.killSwitch;
  }

  /**
   * LRO-17：调用方因预算耗尽而**中止执行**时记录一条 warn。
   *
   * 闸门路径（`TAORLoop` 等）原先是**静默 return**（仅置 stopReason）⇒ 长程任务被日限额
   * 腰斩却在 `app.log` 查无此事。由本单例统一记录：既补齐可见性，也避免各闸门重复实现。
   */
  logExhaustionAbort(context: Record<string, unknown> = {}): void {
    const state = this._computeState();
    logger.warn(
      'dailyBudget:exhausted_abort — 日 Token 预算已耗尽，调用方中止执行',
      {
        ...context,
        todayUsed: state.todayUsed,
        projectedUsed: state.projectedUsed,
        dailyLimit: state.dailyLimit,
        percentUsed: Math.round(state.percentUsed * 100),
      }
    );
  }

  /**
   * 检查是否可以执行操作。
   *
   * F4：`locked` 时若存在**未过期**的 `waive-once` 一次性通行证 ⇒ 放过**本轮一次**
   * （否则该能力为"死能力"：用户"放行一次"后闸门仍恒 `locked`）。
   *
   * ⚠️ 此处**故意在谓词内产生一次记账副作用**（置 `_waiverGrantedForSession`）：闸门每轮会被
   * **多次**调用（如 `beforeReasoning` 复检），而仓库内**无现成"轮次边界"**可挂消费点 ⇒
   * 用"取得通行证的会话"标记，交由 `recordUsage()` 末尾消费（Consume-and-Die）。
   *
   * **先认领者独占**：已有认领者时**不覆盖**（通行证是**单次**豁免 ⇒ 应由**最先**用它放行的会话
   * 负责消费；否则后到的会话会在 TTL 窗口内夺走消费归属）。无 sessionId 的调用**不认领**。
   */
  canExecute(sessionId?: string): boolean {
    if (this.getMode().mode !== 'locked') return true;
    if (!this.hasActiveWaiver()) return false;
    if (this._waiverGrantedForSession === null) {
      this._waiverGrantedForSession = sessionId ?? null;
    }
    return true;
  }

  /**
   * 检查是否允许子 Agent（仅 normal 模式）
   */
  canSpawnSubAgent(): boolean {
    return this.getMode().mode === 'normal';
  }

  /**
   * 检查收益递减（每轮结束后调用）
   * 连续两轮 Token 增量 < minTokenDelta 时触发递减
   * @param currentTotalTokens 当前累计 Token 消耗
   * @param elapsedMs 本轮耗时（可选，用于补充耗时维度检测）
   */
  checkDiminishingReturns(
    currentTotalTokens: number,
    elapsedMs?: number
  ): { diminishing: boolean; reason?: string } {
    const delta = currentTotalTokens - this.lastTotalTokens;
    this.lastTotalTokens = currentTotalTokens;

    // 耗时维度：连续 2 轮耗时 > 30s 但 token 增量 < 1000，跳级加速触发
    if (elapsedMs !== undefined && elapsedMs > 30_000 && delta < 1000) {
      this.diminishingTurnsCount += 2;
    }

    if (delta < this.config.minTokenDelta) {
      this.diminishingTurnsCount++;

      if (this.diminishingTurnsCount >= this.config.diminishingTurnsThreshold) {
        return {
          diminishing: true,
          reason: `连续 ${this.diminishingTurnsCount} 轮 Token 增量低于阈值 (${this.config.minTokenDelta})，可能已陷入低效循环`,
        };
      }

      return { diminishing: false };
    }

    // Token 有进展 → 重置
    this.diminishingTurnsCount = 0;
    return { diminishing: false };
  }

  /**
   * 重置收益递减计数（run/恢复边界调用）
   *
   * `baselineTokens` 必须与 `checkDiminishingReturns` 的入参**同源**（loop 的当前累计 Token）
   * —— 否则恢复后首轮的 delta 会被算错（沿用 `todayUsed` 会与 loop 视角的累计量脱节）。
   * 缺省 `undefined` 时保留旧语义（以 `todayUsed` 为基线）。
   */
  resetDiminishingReturns(baselineTokens?: number): void {
    this.lastTotalTokens = baselineTokens ?? this.todayUsed;
    this.diminishingTurnsCount = 0;
  }

  /**
   * 检查是否需要优雅最后一次调用
   * 当预算耗尽但当前正在执行工具调用时，允许完成当前轮
   */
  needsGraceCall(): boolean {
    if (this._graceCallActive) return false;

    const mode = this.getMode();
    if (mode.mode === 'locked' && !this._graceCallActive) {
      this._graceCallActive = true;
      return true;
    }

    return false;
  }

  /**
   * 确认优雅调用已使用
   */
  consumeGraceCall(): void {
    this._graceCallActive = true;
  }

  /**
   * 是否已完成优雅调用
   */
  graceCallConsumed(): boolean {
    return this._graceCallActive;
  }

  /**
   * 从持久化恢复预算状态
   * 修复重启后 lastTotalTokens=0 导致首轮 delta 被误判为"有进展"
   *
   * P1/P3：`date` 为持久化快照的**本地**自然日；与今日不同 ⇒ 视为跨日，用量归零
   * （不把昨天的用量带进今天）。未提供 `date` 时保持历史语义（直接恢复）。
   */
  restore(state: {
    todayUsed: number;
    date?: string;
    /** D-b：随状态恢复的放行（**结构等价**于内部 `ReliefState`，避免暴露私有类型） */
    relief?: {
      kind: ReliefKind;
      expiresAt: number | null;
      factor?: number;
      amount?: number;
    } | null;
    /** D-d：随状态恢复的透支欠账 */
    debt?: number;
    /** 债四 S5：随状态恢复的 USD 已用（缺省 ⇒ 沿用内存现值） */
    usedUsd?: number;
    /** 债四 S5：随状态恢复的 USD 欠账（缺省 ⇒ 沿用内存现值） */
    debtUsd?: number;
  }): void {
    const today = this._getToday();
    const sameDay = state.date === undefined || state.date === today;
    this.todayDate = today;
    // D-d：跨日恢复 ⇒ 昨日用量归零并**先计入欠账**（透支扣回）；relief 一律不跨日（D-b）。
    // 欠账取"快照里的值，缺省则沿用内存现值"——部分快照不得抹掉已有欠账（§6.1 C3）。
    const carriedDebt = state.debt ?? this.debtTokens;
    this.todayUsed = sameDay ? state.todayUsed : carriedDebt;
    this.debtTokens = sameDay ? carriedDebt : 0;
    // 债四 S5：USD 两字段与 token 口径**同法**恢复（跨日 ⇒ 昨日已用归零、欠账计入新的一天）
    const carriedDebtUsd = state.debtUsd ?? this.debtUsd;
    this.usedUsd = sameDay ? (state.usedUsd ?? this.usedUsd) : carriedDebtUsd;
    this.debtUsd = sameDay ? carriedDebtUsd : 0;
    this.reliefState = sameDay ? (state.relief ?? null) : null;
    this.waiveOncePending = null;
    // 过期 relief 立即作废（防"重启即提额"）
    this._activeRelief();
    this.lastTotalTokens = this.todayUsed;
    this.diminishingTurnsCount = 0;
    this.outstandingBySession.clear();
    // LRO-17：静默同步已观测模式（重启时按恢复后的用量对齐，避免对"早已 locked"的
    // 状态重复告警；真实的跨越仅由本进程内的记账/查询触发）。
    this.lastObservedMode = this._computeState().mode;
  }

  /**
   * P1：把当前用量**去抖落盘**（1s 合并热路径的多次记账写文件）。
   * 去抖窗口内进程退出最多丢失 1s 用量，对日限额可忽略。
   */
  private _schedulePersist(): void {
    if (!this._persistenceActive) return;
    if (this._persistTimer) return;
    const t = setTimeout(() => {
      this._persistTimer = null;
      void saveDailyBudgetState(this._persistedState());
    }, PERSIST_DEBOUNCE_MS);
    // 不阻止进程退出（与仓库既有后台定时器一致）
    if (typeof t.unref === 'function') t.unref();
    this._persistTimer = t;
  }

  /** P1：启用用量落盘（由启动接线 `initDailyBudget()` 调用）。 */
  enablePersistence(): void {
    this._persistenceActive = true;
  }

  /** 立即落盘并取消未决去抖（供关闭钩子 / 测试显式等待）。未激活时为 no-op。 */
  async persistNow(): Promise<void> {
    if (!this._persistenceActive) return;
    if (this._persistTimer) {
      clearTimeout(this._persistTimer);
      this._persistTimer = null;
    }
    await saveDailyBudgetState(this._persistedState());
  }

  /**
   * 设置 kill switch
   */
  enableKillSwitch(): void {
    this.killSwitch = true;
  }

  disableKillSwitch(): void {
    this.killSwitch = false;
  }

  /**
   * 重置当日统计
   */
  reset(): void {
    this.todayUsed = 0;
    // 债四 S5：USD 已用同法归零；欠账（`debtUsd`）**不清**（与 `debtTokens` 同约定，防反复 reset 洗透支）
    this.usedUsd = 0;
    this.todayDate = '';
    this.killSwitch = false;
    this.lastTotalTokens = 0;
    this.diminishingTurnsCount = 0;
    this._graceCallActive = false;
    this.outstandingBySession.clear();
    // D-b / §6.1 C3：`reset()` 清**放行状态**，但**不清欠账**（否则可反复 reset 洗掉透支）。
    this.reliefState = null;
    this.waiveOncePending = null;
    this._waiverGrantedForSession = null;
    this.lastObservedMode = 'normal'; // LRO-17：重置观测基线
    // P1：重置同样落盘，避免"重置后重启"把旧用量恢复回来。
    void this.persistNow();
  }

  /**
   * **本地**自然日（YYYY-MM-DD）。
   *
   * P3 修复：原用 `toISOString()`（UTC）⇒ 对 `Asia/Shanghai`(+08:00)，"日界"落在**本地 08:00**，
   * 凌晨 0–8 点的用量被计入"前一天"，与用户对"今日额度"的直觉不符。改为读取本地时区年月日。
   */
  private _getToday(): string {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
}

export function createDailyBudgetManager(
  config?: Partial<DailyBudgetConfig>
): DailyBudgetManager {
  return new DailyBudgetManager(config);
}

/** D1：持久化配置项形状（ConfigManager 键 `costControl.dailyTokenBudget`） */
export interface DailyBudgetConfigValue {
  dailyLimit?: number;
  warningThreshold?: number;
  lockThreshold?: number;
}

function isPositiveInt(n: unknown): n is number {
  return typeof n === 'number' && Number.isInteger(n) && n > 0;
}

/** 阈值必须为 (0, 1] 的比值 */
function isRatio(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n) && n > 0 && n <= 1;
}

/** D1：日预算上限合法性（正整数）—— 供 `applyConfig` 与 HTTP 边界校验**共用**（CS01 归一化）。 */
export function isValidDailyLimit(n: unknown): n is number {
  return isPositiveInt(n);
}

/** D1：日预算阈值合法性（(0, 1] 比值）—— 与 `applyConfig` 共用同一口径。 */
export function isValidBudgetRatio(n: unknown): n is number {
  return isRatio(n);
}

/**
 * 债四 USD-2（2026-10-13，方案 §6.3）：**USD 口径上限**合法性（**正有限数**）。
 *
 * 与 `isValidDailyLimit`（**正整数**）的区别：金额**允许小数**（如 `0.5` USD/日）。
 * 供 HTTP 边界（fail-loud 400）与 `setLimitUsd`（与 `applyConfig` 同款宽容）**共用**（CS01）。
 */
export function isValidDailyLimitUsd(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n) && n > 0;
}

/**
 * D1：日预算上限/阈值的**持久化配置键**（单一事实来源）。
 *
 * 读侧（`resolveDailyBudgetConfig`）与写侧（HTTP `PUT /v1/cost/daily-budget`、CLI `/budget set`）
 * 必须同键 —— 此前该字面量散落多处，任一处改动都会让"写进去的键"与"读的键"错位（静默失效）。
 */
export const DAILY_BUDGET_CONFIG_KEY = 'costControl.dailyTokenBudget';

/**
 * 债四 S5（T3-5/6/7，2026-10-13）：**USD 口径上限**的持久化配置键（单一事实来源）。
 *
 * ⚠️ 与 `DAILY_BUDGET_CONFIG_KEY`（Token 口径）**并列、互不替代**；**无默认值** ——
 * `§12 Q-U3` 未裁定 ⇒ 未配置即 `undefined`（USD 闸门不启用）。env 兜底：`LIRI_DAILY_BUDGET_USD`。
 */
export const DAILY_BUDGET_USD_CONFIG_KEY = 'costControl.dailyBudgetUSD';

/**
 * D1：解析日 Token 限额上限与阈值（**单一事实来源**）。
 *
 * 优先级：ConfigManager **持久化配置**（`costControl.dailyTokenBudget`）
 * ＞ 环境变量 `LIRI_DAILY_BUDGET_TOKENS`（降级为首次播种/兜底）＞ 常量。
 *
 * 修复 P2：原上限只在单例创建时读一次 `process.env`，前端/API 无法配置、运行时不可改。
 */
export function resolveDailyBudgetConfig(): {
  dailyLimit: number;
  warningThreshold: number;
  lockThreshold: number;
  /** 债四 S5：USD 口径上限；**未配置 ⇒ `undefined`**（USD 闸门不启用 —— §12 Q-U3 未裁定，无默认值） */
  limitUsd?: number;
} {
  const cfg = configManager.getConfigValue<DailyBudgetConfigValue>(
    DAILY_BUDGET_CONFIG_KEY
  );
  const raw = configManager.env('LIRI_DAILY_BUDGET_TOKENS');
  const parsed = Number.parseInt(raw ?? '', 10);
  const envLimit =
    raw && Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;

  // 债四 S5：USD 上限（新键 > env > **无默认值**）—— 与 token 口径**并列**，不共享兜底常量。
  const cfgUsd = configManager.getConfigValue<unknown>(
    DAILY_BUDGET_USD_CONFIG_KEY
  );
  const rawUsd = configManager.env('LIRI_DAILY_BUDGET_USD');
  const parsedUsd = Number.parseFloat(rawUsd ?? '');
  const envLimitUsd =
    rawUsd && Number.isFinite(parsedUsd) && parsedUsd > 0
      ? parsedUsd
      : undefined;
  const cfgLimitUsd =
    typeof cfgUsd === 'number' && Number.isFinite(cfgUsd) && cfgUsd > 0
      ? cfgUsd
      : undefined;

  return {
    dailyLimit: isPositiveInt(cfg?.dailyLimit)
      ? cfg.dailyLimit
      : (envLimit ?? DEFAULT_DAILY_BUDGET_TOKENS),
    ...(cfgLimitUsd !== undefined || envLimitUsd !== undefined
      ? { limitUsd: cfgLimitUsd ?? envLimitUsd }
      : {}),
    warningThreshold: isRatio(cfg?.warningThreshold)
      ? cfg.warningThreshold
      : DEFAULT_CONFIG.warningThreshold,
    lockThreshold: isRatio(cfg?.lockThreshold)
      ? cfg.lockThreshold
      : DEFAULT_CONFIG.lockThreshold,
  };
}

/**
 * 进程级**共享**每日 Token 预算单例（R16 / 台账 L-14）。
 *
 * - **(a) 单一闸门实例**：主对话预检（`preSendContextProtection`）与 `TAORLoop` 的**日预算闸门**
 *   共用本实例（原 TAORLoop 自建、从不记账 ⇒ 闸门恒真/惰性）。
 * - **(b) 单一记账点**：由 `ChatManager.recordChatResponseUsage`（每次模型响应）记入 ——
 *   覆盖主路径/快速路径/流式，替代原"仅记**最后一次**调用"的 `recordDailyUsage`。
 * - **(c) 上限/阈值来源**（D1，见 `resolveDailyBudgetConfig`）：持久化配置
 *   `costControl.dailyTokenBudget` ＞ env `LIRI_DAILY_BUDGET_TOKENS` ＞ 常量。
 *   运行时改动经 `applyConfig`/`setLimit` **热更新**（无需重启）。
 *
 * 注：`TAORLoop` 仍保留**自己的**实例用于 **loop-local** 的 `checkDiminishingReturns`/`needsGraceCall`
 * （其状态按循环/轮次计，**不能**跨会话共享）——故"去双实例"仅指**闸门**收敛到本单例。
 */
let dailyBudgetSingleton: DailyBudgetManager | null = null;

export function getDailyBudget(): DailyBudgetManager {
  if (!dailyBudgetSingleton) {
    dailyBudgetSingleton = createDailyBudgetManager(resolveDailyBudgetConfig());
  }
  return dailyBudgetSingleton;
}

/** 仅供测试：重置单例（生产不使用）。 */
export function resetDailyBudgetForTest(): void {
  dailyBudgetSingleton = null;
}

/**
 * P1：启动时从持久化**恢复**当日用量（由 `entrypoints/init` 接线）。
 *
 * 恢复后若持久化日期 ≠ 今日（跨本地日界）⇒ `restore` 内部归零。
 * 文件缺失/损坏由持久化层吞掉并返回 `null` ⇒ 从 0 起算（不阻塞启动）。
 */
export async function initDailyBudget(): Promise<void> {
  const budget = getDailyBudget();
  budget.enablePersistence(); // 启动后才"接管"状态文件（未启用时持久化整体不生效）
  const persisted = await loadDailyBudgetState();
  if (persisted) {
    budget.restore({
      todayUsed: persisted.used,
      date: persisted.date,
      debt: persisted.debt,
      relief: persisted.relief,
      // 2026-10-15（USD 日限额启用前置修复）：**必须透传 USD 两字段**。
      // 漏传 ⇒ `restore()` 内 `state.usedUsd === undefined` ⇒ 沿用内存现值 0
      // ⇒ **USD 台账重启即清零**（真机实证：状态文件 `usedUsd=0.863076`，API 返回 `usedUsd:0`；
      // 同一次响应里 token 侧 `todayUsed` 恢复正确 ⇒ 仅 USD 轨丢失）。
      // 与 `dailyBudgetPersistence.ts` 注释所载 D-b/D-d 历史缺陷**同型**：读取侧已补字段，
      // 调用侧未同步透传。USD 闸门启用后，清零即"重启绕过限额"。
      usedUsd: persisted.usedUsd,
      debtUsd: persisted.debtUsd,
    });
  }
}

/**
 * 从 LLM `usage` 记录**统一提取** `input+output` 并计入每日预算（R16 统一口径）。
 *
 * 兼容 `inputTokens/outputTokens`（内部归一化）与 `prompt_tokens/completion_tokens`（OpenAI 形）。
 * 返回实际计入的 tokens（0 表示无有效 usage，未计入）。
 *
 * @param model 本轮实际模型（债四「换算接线」；供**金额**台账取价）。缺失 ⇒ 只记 token、
 *   **不记金额**（`recordTurnCostUsd` 内部如实 warn，**不臆造金额**）。
 *
 * 用途：**非 chat 管线**的模型调用（如长程任务默认执行器 `LongRunningTaskOrchestrator`
 * 的 `service.generate`）——该路径不经 `ChatManager.recordChatResponseUsage`，故在此单点记账。
 *
 * ⚠️ **边界（D-j，Spec `daily-budget-over-limit-ux.md` §4/§5-D-2）**：日预算只收**对话类**
 * 入口（"有人在场"）。**无人看后台**（H 做梦 / I 会话摘要 / J 自动标题 / N 记忆·进化，
 * 以及疑未接线的 O `BtwHandler`）**不得**调用本函数或 `getDailyBudget().recordUsage()`——
 * 否则后台会替用户吃掉额度、让用户更早被拦（Spec §2 反目标）。该边界由
 * `app/tests/budget/sideChannelGuard.test.ts` 的负向夹具 + 源码守卫钉住。
 */
export function recordDailyBudgetFromUsage(
  usage: unknown,
  sessionId?: string,
  model?: string
): number {
  const u = (usage ?? {}) as Record<string, number>;
  const input = u.inputTokens ?? u.prompt_tokens ?? 0;
  const output = u.outputTokens ?? u.completion_tokens ?? 0;
  const total = input + output;
  if (total > 0) getDailyBudget().recordUsage(total, sessionId);
  // 债四「换算接线」：**金额**台账与 token 口径**并行**（`recordTurnCostUsd` 内部按模型取价换算）。
  // ⚠️ 本路径**不提取缓存字段**（`extractCacheTokens` 属 `ai` 层 ⇒ query→ai 会造成模块级环）⇒
  //    缓存用量按缺失处理（**不臆造 0 之外的数**）；chat 主链的「缓存纳入」见 `ChatManager`。
  if (total > 0) {
    recordTurnCostUsd(
      { inputTokens: input, outputTokens: output },
      model,
      sessionId
    );
  }
  return total;
}

/** 单轮用量的**四参形状**（与计费链同参；Q-U4：`input/output/cacheCreation/cacheRead`） */
export interface TurnCostUsageParts {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens?: number;
  cacheReadTokens?: number;
}

/**
 * 债四「换算接线」（2026-10-13）：把**单轮真实用量 + 本轮模型**折算为**金额**并记入 USD 台账
 * （债四 S5 的 `recordUsdUsage` **首个生产消费者**）。
 *
 * 口径：取价 core SPI（`model_registry`）→ core 零依赖 `calculateTotalCost`（S1/S2）
 * ⇒ **与成本报表计费链同源**（spec §6-1「同源」，规避「判了却不符」）。
 *
 * 边界（如实）：
 *  - 模型名**不可得**（空 / `'unknown'` 占位）⇒ **不入账**、**不臆造金额**（spec §3-D2 明文禁止
 *    "回落后静默取兜底价"）—— 只记一条 warn 如实标注（Q-U5 精神：不静默）；
 *  - 模型**已命名但未登记/零定价** ⇒ **仍入账**（按兜底价，降级可用）但打 warn 如实标注 `unknownModel`；
 *  - `usd <= 0` ⇒ `recordUsdUsage` 内部幂等 no-op（不落盘）；
 *  - **闸门判定不变**：本函数只增**金额台账**，`usedUsd` 当前**不参与**任何拦截/档位判定
 *    （USD 闸门 = S3，受 `§12 Q-U3` 未裁定挡住）⇒ 对"是否拦截"零影响。
 *
 * @returns 实际计入的 USD（`0` = 未计入）
 */
export function recordTurnCostUsd(
  parts: TurnCostUsageParts,
  model: string | undefined,
  sessionId?: string
): number {
  if (!model || model === 'unknown') {
    // `debug`（非 warn）：调用方**未提供**模型（如长程任务自定义执行器路径）属"不适用"，
    // 不是异常；关键是**不取兜底价、不臆造金额**（Q-U5「不静默」针对的是"悄悄用了兜底价"）。
    //
    // 2026-10-15（日限额「USD 台账同源化」修复）：原为 `debug` ⇒ 默认级别下**完全不可见**，
    // 使"USD 台账漏记"长期静默 —— 真机实测当日 `usedUsd=$0.863` vs 计费侧 `$3.6866`
    // （仅覆盖 29%），根因即 CLI 对话路径（`Chat.ts`）调 `recordDailyBudgetFromUsage`
    // 时未传 `model`。此处升为 `warn`：模型不可得是**应可见的记账缺口**，
    // 调用方应补齐 `model`（同源的 `costTracker.addCost` 已有该值）。定价语义不变。
    logger.warn(
      'dailyBudget:usd_skip — 模型名不可得，跳过金额记账（USD 台账将出现缺口，不臆造金额）',
      { sessionId, model: model ?? null }
    );
    return 0;
  }
  const { costUsd, unknownModel } = estimateTurnCostUsd(model, parts);
  if (unknownModel) {
    logger.warn(
      'dailyBudget:usd_unknown_model — 模型未登记/零定价，已按兜底价折算（如实标注）',
      { sessionId, model, costUsd }
    );
  }
  getDailyBudget().recordUsdUsage(costUsd, sessionId);
  return costUsd;
}
