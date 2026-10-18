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
 * BudgetSuspendCoordinator — 预算挂起协调器（**服务层单例**）
 *
 * 长任务撞每日预算上限时挂起、用户放行后续跑（spec `long-task-suspend-resume.md`）。
 * 本文件只持**内存登记**（`Map<sessionId, SuspendEntry>`）—— **不是**持久化事实源：
 * 挂起事实源是各链各自的检查点（流式 `SessionCheckpoint` / batch `taor_checkpoints`），
 * 由 Task 5/6 落盘；本协调器仅作进程内查询/唤醒决策的缓存面。
 *
 * 边界（照 spec §4.1 定义）：
 *  - 本模块**不订阅**任何事件、**不**主动调用唤醒 handler（那是 Task 7）；此处只提供
 *    `setResumeHandler` 挂点。
 *  - **不得** import `chat/**`（会与 chat→query 成环）；唤醒经注入的 handler 端口。
 *  - 新行为统一由 `FEATURE_BUDGET_SUSPEND_RESUME`（**默认开**；`=false` 即关）门控 ⇒ 关时零行为变更。
 */

import { configManager } from '@modules/config';
import { getLogger } from '@modules/monitoring';
import { publishStateProjection } from '../state/engine/projectionBroker.js';
import {
  freezeSessionSnapshot,
  restoreSessionSnapshot,
  type SessionSnapshot,
} from '../state/engine/sessionSnapshot.js';
import type { ReliefKind } from './DailyBudgetManager.js';

const logger = getLogger('query:budgetSuspend');

/**
 * 挂起链类型：流式（`StreamingAutoCheckpoint`）/ batch（`TAORLoop` 检查点）。
 *
 * `'tool-job'`（T1-2② C₂，2026-10-13）：**侧车作业挂起** —— 语义上**不是**可续跑的链，
 * 而是「等一个长耗时作业完成」的**来源标记**：此类挂起**无链续跑通道**，由作业完成通知
 * **自动续跑**（`query/toolJobSuspend.ts`）。relief（只唤醒 `kind='budget'`）与 guard 继续入口
 * （只受理 `kind='guard'`）均由 `kind` 判据**天然排除**它。
 */
export type SuspendChain = 'stream' | 'taor' | 'tool-job';

/**
 * **可续跑链**（`SuspendChain` **排除** `'tool-job'`）：只有真实执行链才有"链续跑通道"。
 *
 * 用于**续跑通道**的入参类型（`BudgetResumeHandler` / guard 继续入口）⇒ 在**编译期**就拒绝
 * 「拿作业挂起去走链续跑」这类语义错误（`'tool-job'` 由作业完成通知**自动续跑**）。
 */
export type ResumableSuspendChain = Exclude<SuspendChain, 'tool-job'>;

/** 该链是否有**链续跑通道**（`'tool-job'` ⇒ 无）—— 续跑通道前的**单一判据** */
export function isResumableChain(
  chain: SuspendChain
): chain is ResumableSuspendChain {
  return chain !== 'tool-job';
}

/**
 * 挂起**类别**（T3-12，2026-10-13）：
 *  - `'budget'`（缺省，向后兼容）：日预算耗尽挂起 ⇒ 由 **relief**（boost/waive-once/unlock-today）唤醒；
 *  - `'guard'`：guard 挂起（熵门禁 `schema_entropy` / 轮上限 `turn_limit`）⇒ **绝不**被 relief 唤醒，
 *    只能经独立继续入口 `POST /v1/sessions/:id/continue`（`coordinator.release` + 既有续跑通道）；
 *  - `'tool-job'`（T1-2② C₂，2026-10-13）：**侧车作业挂起**（`query/toolJobSuspend.ts`）——
 *    长耗时侧车工具「提交即返、完成后续跑」期间的登记；**既**不被 relief 唤醒（同 guard），
 *    **也不**经 guard 继续入口（那是人工放行通道）⇒ 由**作业完成通知自动续跑**。
 */
export type SuspendKind = 'budget' | 'guard' | 'tool-job';

/** 单条挂起登记 */
export interface SuspendEntry {
  sessionId: string;
  chain: SuspendChain;
  checkpointRef?: string;
  suspendedAt: number;
  reason: string;
  /** 挂起类别；**缺省视为 `'budget'`**（历史条目/既有调用零改动兼容） */
  kind?: SuspendKind;
}

/**
 * 该条目是否可被 **relief 放行** 唤醒（T3-12）：仅 `kind==='budget'`（含缺省）。
 *
 * 提取为模块级纯函数 ⇒ 不增加 `onReliefApplied` 的圈复杂度，且兼作"relief 只唤醒 budget"的单点判据。
 */
function isReliefEligible(entry: SuspendEntry & { expired: boolean }): boolean {
  return !entry.expired && (entry.kind ?? 'budget') === 'budget';
}

/**
 * 唤醒处理器端口（由 Task 7 装配注入）。
 *
 * 入参 = 目标会话与其链类型；返回是否唤醒成功。**本任务只提供挂点，不调用它**。
 * 链类型取 {@link ResumableSuspendChain}（**排除** `'tool-job'`：作业挂起无链续跑通道）。
 */
export interface BudgetResumeHandler {
  (sessionId: string, chain: ResumableSuspendChain): Promise<boolean>;
}

/**
 * 挂起 TTL（**24h**）。
 *
 * 与 `ResumeManager` 的检查点过期**同值同语义**（`query/ResumeManager.ts` 的
 * `24 * 60 * 60 * 1000`），不引入第二套阈值。超过该 TTL 的条目在 `list()` 中标记
 * `expired`，**不**删除、**不**改标为失败（D6）。
 */
export const SUSPEND_TTL_MS = 24 * 60 * 60 * 1000;

const DEFAULT_BUDGET_RESUME_MAX_PER_WAKE = 3;

/**
 * 单次放行最多唤醒数（默认 **3**；env 可调）。
 *
 * env 名 `BUDGET_RESUME_MAX_PER_WAKE`（spec 字面），经统一出入口 `configManager.env()` 读取
 * （R05-012）；缺失/非法（非正整数）⇒ 回退默认 3。上限场景见 spec D5：额度刚放行即批量
 * 唤醒会立刻再撞限 ⇒ 只唤醒最早的 N 个，其余**保持挂起**（不丢状态）。
 */
export const BUDGET_RESUME_MAX_PER_WAKE = resolveBudgetResumeMaxPerWake();

/** 解析唤醒上限（env 优先，非法/异常 ⇒ 默认 3）；导出供测试锁定 env 键名。 */
export function resolveBudgetResumeMaxPerWake(): number {
  try {
    const raw = configManager.env('BUDGET_RESUME_MAX_PER_WAKE');
    const parsed = Number.parseInt(raw ?? '', 10);
    return Number.isInteger(parsed) && parsed > 0
      ? parsed
      : DEFAULT_BUDGET_RESUME_MAX_PER_WAKE;
  } catch {
    return DEFAULT_BUDGET_RESUME_MAX_PER_WAKE;
  }
}

/**
 * 预算挂起协调器（进程级单例）。
 *
 * 挂起事实源在检查点 ⇒ 本类只持内存登记；`suspendedAt` 由设备时钟 `Date.now()` 生成，
 * `expired` **不进存储**（`list()` 时现算）。
 */
export class BudgetSuspendCoordinator {
  /** `sessionId → 挂起登记`（内存缓存；非持久化事实源） */
  private readonly entries = new Map<string, SuspendEntry>();

  /**
   * `sessionId → 编排引擎会话快照`（U-14 阶段 1.3）。
   *
   * 与挂起登记同生命周期：`suspend()` 冻结、`release()` 丢弃；恢复发生在**续跑通道启动前**。
   * 仅内存（引擎侧也为内存态），进程重启后无快照 —— 与「挂起事实源在检查点」的口径一致。
   */
  private readonly snapshots = new Map<string, SessionSnapshot>();

  /** 唤醒处理器端口；由 Task 7 注入，本任务只保存不调用 */
  private resumeHandler: BudgetResumeHandler | null = null;

  /**
   * 登记挂起。
   *
   * 主键 = `sessionId`（一会话至多一个挂起点）：**同 session 重复调用 ⇒ 保留最早一条**
   * （不覆盖），使 `list()` 的挂起时间序稳定（D5）。`suspendedAt` 由设备时钟生成。
   *
   * U-14 阶段 1.3：首次登记时按会话冻结编排引擎内存态（无提供者 ⇒ 跳过，不造空快照）。
   */
  suspend(e: Omit<SuspendEntry, 'suspendedAt'>): void {
    if (this.entries.has(e.sessionId)) return;
    this.entries.set(e.sessionId, { ...e, suspendedAt: Date.now() });
    this.captureSnapshot(e.sessionId);
    // Task 8：只读四原语投影（SUSPENDED）+ 结构化日志。投影受
    // `FEATURE_STATE_PROJECTION_BROADCAST` 门控（关 ⇒ 零投影），但**登记照常**
    // ⇒ 可见性不以投影为准。
    publishStateProjection({
      domain: 'execution',
      primitive: 'SUSPENDED',
      sessionId: e.sessionId,
    });
    logger.info('budgetSuspend:suspended', {
      sessionId: e.sessionId,
      chain: e.chain,
      reason: e.reason,
    });
  }

  /**
   * 恢复该会话的编排快照（U-14 阶段 1.3）。
   *
   * **必须在续跑通道启动前**调用（`onReliefApplied` / guard 继续入口 / 作业完成续跑）：
   * 引擎按 `sessionId` 恢复自己的内存态。未登记/已恢复/无提供者 ⇒ no-op（幂等）。
   * 不删除快照 —— 续跑失败回滚为挂起时，下一次放行仍可用。
   */
  restoreSnapshot(sessionId: string): void {
    const snapshot = this.snapshots.get(sessionId);
    if (!snapshot) return;
    restoreSessionSnapshot(snapshot);
  }

  /** 按会话冻结编排引擎内存态（失败由注册表逐条留痕，绝不阻断挂起） */
  private captureSnapshot(sessionId: string): void {
    const snapshot = freezeSessionSnapshot(sessionId);
    if (snapshot) {
      this.snapshots.set(sessionId, snapshot);
    } else {
      this.snapshots.delete(sessionId);
    }
  }

  /**
   * Task 7：放行 ⇒ 按决策规则唤醒挂起会话（经注入的 handler 端口）。
   *
   * - `boost` / `unlock-today` ⇒ 按挂起时间**升序**、**串行**，`handler` **调用数** ≤ `resolveBudgetResumeMaxPerWake()`；
   * - `waive-once` ⇒ **只唤醒最早期挂起的 1 个**（单次额度语义）；
   * - 幂等：唤醒前先 `release` 占位（已释放者跳过）⇒ 并发/重复放行至多唤醒一次；
   * - 过期（>24h）不唤醒；handler 返回 `false` ⇒ 回滚为挂起（保留原挂起时刻）+ warn；
   * - 未设 handler ⇒ 只 warn，不报错、不改登记。
   *
   * **`targetSessionId`（可选）= 把本次唤醒**收窄**到该会话**（2026-10-17 用户裁定，见
   * spec D5 增补）：放行**额度本身**仍是全局的（日预算是当日共享资源，无法按会话提额），
   * 但**唤醒范围**可指定 —— 卡片入口的「继续」即"提额 + 只续跑本会话"，避免用户在某会话
   * 点继续时**别的会话自行开跑并花钱**（真机 E2E 实证的落差）。缺省（`undefined`）= 旧口径
   * （时间序 + 上限）⇒ 用量中心/设置页等既有调用**零行为变更**。
   *
   * @returns 本次实际唤醒的 `sessionId` 列表
   */
  async onReliefApplied(
    kind: ReliefKind,
    targetSessionId?: string
  ): Promise<{ woken: string[] }> {
    const handler = this.resumeHandler;
    if (!handler) {
      logger.warn(
        'budgetSuspend:relief_no_handler — 未装配唤醒处理器，跳过唤醒',
        { kind }
      );
      return { woken: [] };
    }
    // 收窄到单会话时上限恒 1（候选至多 1 条）；未收窄时沿用 `waive-once`=1 / 其余=env 上限。
    const limit =
      targetSessionId !== undefined || kind === 'waive-once'
        ? 1
        : resolveBudgetResumeMaxPerWake();
    // T3-12：relief 只唤醒 `kind==='budget'`（缺省）候选 —— **绝不**唤醒 guard 挂起
    // （落实"guard 挂起不复用 relief 放行通道"）。
    const candidates = this.list()
      .filter(isReliefEligible)
      .filter(
        (e) => targetSessionId === undefined || e.sessionId === targetSessionId
      );
    const woken: string[] = [];
    // M3（最终整支评审）：上限按 **handler 调用数**计（而非"成功数"）—— 否则 handler 持续失败时
    // 会遍历全部候选（尝试次数远超上限）。
    let attempts = 0;
    for (const entry of candidates) {
      if (attempts >= limit) break;
      // 幂等/并发占位：已 release 者跳过
      if (!this.entries.has(entry.sessionId)) continue;
      // 无链续跑通道的挂起（`'tool-job'`）**不进**链唤醒（relief 只收 budget 条目 ⇒ 实际恒不触发；
      // 此处是**类型层**与**语义层**的双保险：作业挂起由完成通知自动续跑）
      if (!isResumableChain(entry.chain)) continue;
      // U-14 阶段 1.3：续跑通道启动**前**恢复该会话的编排内存态（失败只留痕）
      this.restoreSnapshot(entry.sessionId);
      this.release(entry.sessionId);
      attempts += 1;
      let ok = false;
      try {
        ok = await handler(entry.sessionId, entry.chain);
      } catch (err) {
        logger.warn('budgetSuspend:resume_handler_error — 唤醒处理器抛错', {
          sessionId: entry.sessionId,
          chain: entry.chain,
          error: err instanceof Error ? err.message : String(err),
        });
        ok = false;
      }
      if (ok) {
        woken.push(entry.sessionId);
        // Task 8：唤醒 ⇒ 只读投影 RUNNING + 结构化日志
        publishStateProjection({
          domain: 'execution',
          primitive: 'RUNNING',
          sessionId: entry.sessionId,
        });
        // M3：日志记 **relief kind**（修复前误记挂起原因 `entry.reason`）。
        logger.info('budgetSuspend:resumed', {
          sessionId: entry.sessionId,
          chain: entry.chain,
          kind,
        });
      } else {
        // 回滚为挂起（直接写回，保留原挂起时刻 ⇒ 时间序不漂移）+ warn
        this.entries.set(entry.sessionId, {
          sessionId: entry.sessionId,
          chain: entry.chain,
          checkpointRef: entry.checkpointRef,
          reason: entry.reason,
          suspendedAt: entry.suspendedAt,
          kind: entry.kind,
        });
        // U-14 阶段 1.3：续跑失败后按**当前**内存态重拍快照（下次放行才可恢复）
        this.captureSnapshot(entry.sessionId);
        logger.warn('budgetSuspend:resume_failed — 唤醒失败，回滚为挂起', {
          sessionId: entry.sessionId,
          chain: entry.chain,
        });
      }
    }
    // M3：一次放行的汇总（带 `woken`，修复前逐条 `resumed` 日志无 woken 汇总）。
    // 收窄放行时**如实带上**收窄目标（否则日志与"为什么只唤醒一条"脱节）。
    logger.info('budgetSuspend:resume_summary', {
      kind,
      woken,
      ...(targetSessionId !== undefined ? { targetSessionId } : {}),
    });
    return { woken };
  }

  /**
   * 该 session 是否处于**有效**挂起态（M3：**计入过期** —— 与 `list().expired` 同口径）。
   *
   * 过期条目仍保留在登记中（供人工查看），但对"是否仍算挂起"的判定应为 `false`
   * （修复前忽略过期 ⇒ 与 `list()`/唤醒判定口径不一致）。
   */
  isSuspended(sessionId: string, now = Date.now()): boolean {
    const entry = this.entries.get(sessionId);
    if (!entry) return false;
    return now - entry.suspendedAt <= SUSPEND_TTL_MS;
  }

  /**
   * 列举挂起条目（按 `suspendedAt` **升序**），并现算 `expired`（距今 > `SUSPEND_TTL_MS`）。
   *
   * 过期条目**保留**（供人工查看/手动作业），仅在调用方用于"是否自动唤醒"的判定。
   */
  list(): readonly (SuspendEntry & { expired: boolean })[] {
    const now = Date.now();
    return [...this.entries.values()]
      .sort((a, b) => a.suspendedAt - b.suspendedAt)
      .map((e) => ({ ...e, expired: now - e.suspendedAt > SUSPEND_TTL_MS }));
  }

  /** 解除挂起（**幂等**：不存在也不报错）；同时丢弃该会话的编排快照 */
  release(sessionId: string): void {
    this.entries.delete(sessionId);
    this.snapshots.delete(sessionId);
  }

  /** 装配唤醒处理器端口（传 `null` 解绑）。本任务只提供挂点，**不**调用。 */
  setResumeHandler(h: BudgetResumeHandler | null): void {
    this.resumeHandler = h;
  }
}

let coordinator: BudgetSuspendCoordinator | null = null;

/** 进程级共享单例（惰性创建） */
export function getBudgetSuspendCoordinator(): BudgetSuspendCoordinator {
  if (!coordinator) {
    coordinator = new BudgetSuspendCoordinator();
  }
  return coordinator;
}

/** 仅供测试：重置单例（生产不使用）。 */
export function resetBudgetSuspendForTest(): void {
  coordinator = null;
}
