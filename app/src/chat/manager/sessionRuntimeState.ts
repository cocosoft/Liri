// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 会话级瞬时运行时状态（P2-1 / R04-001 拆分批，2026-11-15）
 *
 * 三张 **per-session 内存表** 原先各自内联在 `ChatManager` 里（工具轮次计数 / 会话状态机 /
 * 一次性续跑意图），彼此同属「随会话生灭的瞬时状态」，与持久层无关。集中到一处后：
 *   - `ChatManager` 只保留字段 + 薄转发（文件已顶到 R04-001 的 2000 行上限）；
 *   - 三张表共用同一条「会话拆除」语义（`dispose(sessionId)`），避免将来只清其中一张。
 *
 * 语义逐项保留（与拆分前逐字等价）：
 *   - **工具轮次计数**（设计三 2026-08-26）：原全局计数器在并发会话下 turn 编号互相跳变
 *     （A 会话 turn 5/7/9，6/8 被 B 占用）⇒ 改 per-session Map。
 *   - **会话状态机**：获取/创建仍走 `ChatHelper.getOrCreateSessionMachine`（单一实现）。
 *   - **续跑意图**（G-T3-1）：**一次性**标记 —— 只作用于紧接着的那一次委托执行。
 */
import { SessionStateMachine } from '@openliri/infra/state/session/SessionStateMachine';
import { getOrCreateSessionMachine } from '../services/ChatHelper';

export class SessionRuntimeState {
  /** 会话级工具轮次计数（per-session，防并发会话 turn 编号互相跳变） */
  private readonly toolRounds = new Map<string, number>();
  /** 会话状态机映射 */
  private readonly sessionMachines = new Map<string, SessionStateMachine>();
  /** G-T3-1：**一次性**续跑意图登记（`sessionId` 集合） */
  private readonly pendingResumeIntent = new Set<string>();

  /** 工具轮次 +1，返回递增后的轮次 */
  incToolRound(sessionId: string): number {
    const next = (this.toolRounds.get(sessionId) ?? 0) + 1;
    this.toolRounds.set(sessionId, next);
    return next;
  }

  /** 当前工具轮次（未开始 ⇒ 0） */
  getToolRound(sessionId: string): number {
    return this.toolRounds.get(sessionId) ?? 0;
  }

  /** 清空某会话的工具轮次 */
  clearToolRound(sessionId: string): void {
    this.toolRounds.delete(sessionId);
  }

  /** 取（或创建）该会话的状态机 */
  getSessionMachine(sessionId: string): SessionStateMachine {
    return getOrCreateSessionMachine(this.sessionMachines, sessionId);
  }

  /** 登记一次性续跑意图（`resumeSuspendedSession` 的 taor 分支专用） */
  markResumeIntent(sessionId: string): void {
    this.pendingResumeIntent.add(sessionId);
  }

  /** 一次性消费续跑意图：命中即删并返回 `true`；未命中返回 `false` */
  consumePendingResumeIntent(sessionId: string): boolean {
    return this.pendingResumeIntent.delete(sessionId);
  }

  /** 无条件清空某会话的续跑意图（幂等；普通轮开始前调用，防意图泄漏到后续轮次） */
  clearResumeIntent(sessionId: string): void {
    this.pendingResumeIntent.delete(sessionId);
  }
}
