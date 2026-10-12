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
 *  - 新行为统一由 `FEATURE_BUDGET_SUSPEND_RESUME`（默认关）门控 ⇒ 关时零行为变更。
 */

import { configManager } from '@modules/config';

/** 挂起链类型：流式（`StreamingAutoCheckpoint`）/ batch（`TAORLoop` 检查点） */
export type SuspendChain = 'stream' | 'taor';

/** 单条挂起登记 */
export interface SuspendEntry {
  sessionId: string;
  chain: SuspendChain;
  checkpointRef?: string;
  suspendedAt: number;
  reason: string;
}

/**
 * 唤醒处理器端口（由 Task 7 装配注入）。
 *
 * 入参 = 目标会话与其链类型；返回是否唤醒成功。**本任务只提供挂点，不调用它**。
 */
export interface BudgetResumeHandler {
  (sessionId: string, chain: SuspendChain): Promise<boolean>;
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
 * env 名 `LIRI_BUDGET_RESUME_MAX_PER_WAKE`，经统一出入口 `configManager.env()` 读取
 * （R05-012）；缺失/非法（非正整数）⇒ 回退默认 3。上限场景见 spec D5：额度刚放行即批量
 * 唤醒会立刻再撞限 ⇒ 只唤醒最早的 N 个，其余**保持挂起**（不丢状态）。
 */
export const BUDGET_RESUME_MAX_PER_WAKE = resolveBudgetResumeMaxPerWake();

/** 解析唤醒上限（env 优先，非法/异常 ⇒ 默认 3） */
function resolveBudgetResumeMaxPerWake(): number {
  try {
    const raw = configManager.env('LIRI_BUDGET_RESUME_MAX_PER_WAKE');
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

  /** 唤醒处理器端口；由 Task 7 注入，本任务只保存不调用 */
  private resumeHandler: BudgetResumeHandler | null = null;

  /**
   * 登记挂起。
   *
   * 主键 = `sessionId`（一会话至多一个挂起点）：**同 session 重复调用 ⇒ 保留最早一条**
   * （不覆盖），使 `list()` 的挂起时间序稳定（D5）。`suspendedAt` 由设备时钟生成。
   */
  suspend(e: Omit<SuspendEntry, 'suspendedAt'>): void {
    if (this.entries.has(e.sessionId)) return;
    this.entries.set(e.sessionId, { ...e, suspendedAt: Date.now() });
  }

  /** 该 session 是否处于挂起态（**不含**过期判定；过期由 `list()` 现算） */
  isSuspended(sessionId: string): boolean {
    return this.entries.has(sessionId);
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

  /** 解除挂起（**幂等**：不存在也不报错） */
  release(sessionId: string): void {
    this.entries.delete(sessionId);
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
