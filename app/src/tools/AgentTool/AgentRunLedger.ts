// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * AgentRunLedger — 子代理运行台账（O2/O3/O10a 的**单一所有者**）
 *
 * 背景（方案 A2）：原台账由 `AgentTool.activeAgents` 直接读写 + `cleanupCompletedAgents()`
 * 全表扫描清理，形成两类风险 ——
 * ① `this.activeAgents.get(agentId)!.status = …` 的**非空断言**在条目已被清理时抛 TypeError；
 * ② 全表扫描会顺手删掉**别的在途路径**的条目 ⇒ 其后续 `get()!` 抛错。
 * Bun/TS 无线程竞态，真实成因是 `await` 让出造成的**交错（interleaving）**。
 *
 * 设计约束（迁移的是**约束**，不是别处的代码形态）：
 * 1. **单一所有者**：登记 / 置态 / 注销 / 查询四类操作只经本类；
 * 2. **临界区不含 `await`**：本类全部方法为同步块 ⇒ 无让出点 ⇒ 交错不可能发生；
 * 3. **局部化注销**：结算只注销**自己**那一条（替代全表扫描）；
 * 4. **两段式**：非终态留在 `active`（占用并发额度）；终态移入 `recent`（仅供归因，
 *    CAP 默认 200，超出按写入顺序淘汰最旧）；
 * 5. **终态幂等**：首次落定的终态不被后续上报改写（防"工作已完成、收尾组装抛错"被反向写成失败）。
 */

import { getLogger } from '@modules/monitoring';
import type { AgentType } from './types';

const logger = getLogger('tools:AgentTool:AgentRunLedger');

/**
 * 子代理运行状态（O10a③ 补 `cancel_requested`）。
 *
 * `running` / `cancel_requested` 为**非终态**（占用并发额度、条目留在活跃表）；
 * `completed` / `failed` 为**终态**（结算后移入归因表）。
 * 取消受理后**不得直接写 `failed`** —— 失败意为"确定没跑成"，而取消受理只表示
 * "请求已受理、正在下一个安全边界收敛"，此前可能已产生副作用。
 */
export type AgentRunStatus =
  | 'running'
  | 'cancel_requested'
  | 'completed'
  | 'failed';

/** 台账内部条目（含控制面专有字段，不外泄给查询方） */
export interface AgentRunEntry {
  id: string;
  name: string;
  type: AgentType;
  startTime: number;
  status: AgentRunStatus;
  /** 归属父会话（O10a：控制面按会话校验归属用） */
  sessionId?: string;
}

/** 对外查询投影（**不含** `sessionId` 等专有字段；每次新建，调用方改写不影响台账） */
export interface AgentRunView {
  id: string;
  name: string;
  type: AgentType;
  startTime: number;
  status: AgentRunStatus;
}

/** 默认归因保留上限 */
export const DEFAULT_RECENT_CAP = 200;

/** 终态集合（落定后**不可改写**，见 `canTransition`） */
const TERMINAL_STATUSES: ReadonlySet<AgentRunStatus> = new Set([
  'completed',
  'failed',
]);

/** 是否终态（`completed` / `failed`；`running` / `cancel_requested` 为非终态） */
export function isTerminalStatus(status: AgentRunStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}

/**
 * 运行状态机（B3 显式化 —— 原为"隐含在若干 if 里"）
 *
 * ```
 *                register()
 *                    │
 *                    ▼
 *               ┌ running ┐ ── requestCancel() ──▶ ┌──────────────────┐
 *               │         │                        │ cancel_requested │ 非终态
 *               └────┬────┘ ◀── 不可逆 ───────────  └─────────┬────────┘ （占并发槽位）
 *                    │            settle()                    │ settle()
 *                    ▼                                        ▼
 *               ┌───────────┐  终态：不可再迁移（幂等）  ┌────────┐
 *               │ completed │ ◀──────────────────────▶ │ failed │
 *               └───────────┘                          └────────┘
 * ```
 *
 * **合法迁移**：`running → cancel_requested`、`running | cancel_requested → completed | failed`。
 * **非法迁移**：终态 → 任何（幂等保护，防"已完成被反向写成失败"）、
 * `cancel_requested → running`（取消**不可撤销** —— 撤销会让"已受理"的语义撒谎）。
 */
export function canTransition(
  from: AgentRunStatus,
  to: AgentRunStatus
): boolean {
  if (isTerminalStatus(from)) return false;
  if (to === 'running') return false;
  if (to === 'cancel_requested') return from === 'running';
  return true; // → completed | failed
}

export class AgentRunLedger {
  private active = new Map<string, AgentRunEntry>();
  private recent = new Map<string, AgentRunEntry>();

  constructor(private readonly recentCap: number = DEFAULT_RECENT_CAP) {}

  /** 该状态是否**占用运行槽位**（取消受理后引擎尚未收敛 ⇒ 额度不得提前释放） */
  isLive(status: AgentRunStatus): boolean {
    return status === 'running' || status === 'cancel_requested';
  }

  /** 登记新 run（同步） */
  register(params: {
    id: string;
    name: string;
    type: AgentType;
    startTime?: number;
    sessionId?: string;
  }): AgentRunEntry {
    const entry: AgentRunEntry = {
      id: params.id,
      name: params.name,
      type: params.type,
      startTime: params.startTime ?? Date.now(),
      status: 'running',
      sessionId: params.sessionId,
    };
    this.active.set(entry.id, entry);
    return entry;
  }

  /** 当前占用运行槽位的条目数（并发上限判定用） */
  liveCount(): number {
    let count = 0;
    for (const agent of this.active.values()) {
      if (this.isLive(agent.status)) count++;
    }
    return count;
  }

  /**
   * 受理取消（O10a③）：落 `cancel_requested` **中间态**，终态由执行路径落定。
   *
   * @returns 该条目此前是否占用运行槽位（幂等：已受理时重复调用仍返回 true）
   */
  requestCancel(agentId: string): boolean {
    const agent = this.active.get(agentId);
    if (!agent || !this.isLive(agent.status)) return false;
    if (canTransition(agent.status, 'cancel_requested')) {
      agent.status = 'cancel_requested';
    }
    return true;
  }

  /**
   * 落终态并**就地**注销（O2 的核心）。
   *
   * 同步临界区：置态 → 移入归因表 → 从活跃表删除，全程无 `await`。
   *
   * @returns 是否发生了状态迁移（幂等：重复上报或条目不存在均为 false）
   */
  settle(agentId: string, status: 'completed' | 'failed'): boolean {
    const agent = this.active.get(agentId);
    if (!agent) {
      logger.debug('settle 跳过：条目已不在活跃表', { agentId, status });
      return false;
    }
    if (!canTransition(agent.status, status)) {
      logger.debug('settle 被状态机拒绝：非法迁移（终态不可改写）', {
        agentId,
        from: agent.status,
        to: status,
      });
      return false;
    }

    agent.status = status;
    this.active.delete(agentId);
    this.recent.set(agentId, agent);
    while (this.recent.size > this.recentCap) {
      const oldest = this.recent.keys().next().value;
      if (oldest === undefined) break;
      this.recent.delete(oldest);
    }
    return true;
  }

  /** 活跃条目投影（无命中返回 undefined） */
  viewActive(agentId: string): AgentRunView | undefined {
    const agent = this.active.get(agentId);
    return agent ? AgentRunLedger.toView(agent) : undefined;
  }

  /**
   * O10a①：该 run 的**归属会话**——仅供**所有权校验**使用。
   *
   * 刻意不走 `viewActive()` 投影（O10a② 要求查询面**不外泄** `sessionId`）：
   * 控制面需要一个"所有权原语"，而非把专有字段暴露给查询方。
   */
  ownerSessionId(agentId: string): string | undefined {
    return this.active.get(agentId)?.sessionId;
  }

  /** 活跃 → 归因表的查询投影（结算后仍可作答，O2-4） */
  view(agentId: string): AgentRunView | undefined {
    const agent = this.active.get(agentId) ?? this.recent.get(agentId);
    return agent ? AgentRunLedger.toView(agent) : undefined;
  }

  /** 活跃条目列表（每项为新建投影对象） */
  listActive(): AgentRunView[] {
    return Array.from(this.active.values()).map(AgentRunLedger.toView);
  }

  /** 归因表当前条目数（供测试与观测） */
  recentCount(): number {
    return this.recent.size;
  }

  private static toView(agent: AgentRunEntry): AgentRunView {
    return {
      id: agent.id,
      name: agent.name,
      type: agent.type,
      startTime: agent.startTime,
      status: agent.status,
    };
  }
}

/**
 * 进程内共享台账（O15：单一所有者必须**跨实例**成立）。
 *
 * 背景（N6）：台账原为 `AgentTool` 的**实例字段**，而 `AgentTool` 有多个构造点
 * （`ToolManager` 的 loader、`Coordinator`、`getAllBaseTools()`）⇒ "能否再开一个"
 * 只按单实例计数、"是否仍需等待"却按全局会话判定，两套口径并存。
 * 与 `getSubAgentEngine()` / `getAgentRunStore()` 对齐为模块级单例。
 */
let sharedLedger: AgentRunLedger | null = null;

/** 共享台账（所有 `AgentTool` 实例共用同一个所有者） */
export function getAgentRunLedger(): AgentRunLedger {
  if (!sharedLedger) {
    sharedLedger = new AgentRunLedger();
  }
  return sharedLedger;
}

/** 仅测试使用：丢弃共享台账实例，避免用例间状态串味（生产路径不得调用） */
export function resetAgentRunLedger(): void {
  sharedLedger = new AgentRunLedger();
}
