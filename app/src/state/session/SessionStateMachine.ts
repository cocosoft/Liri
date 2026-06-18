/**
 * SessionStateMachine — 会话状态机
 *
 * 管理单个会话的生命周期，提供严格的状态转移校验和便捷方法。
 * 替代已移除的 ChatSessionStateManager 和 SessionStateService。
 */

import { StateMachine } from '../engine/StateMachine';
import { SessionState, SESSION_TRANSITIONS } from './types';
import type { RequiresActionDetails } from './types';

export { SessionState, SESSION_TRANSITIONS };
export type { RequiresActionDetails };

export class SessionStateMachine extends StateMachine<SessionState> {
  /**
   * @param sessionId 会话 ID，作为 contextId 用于日志溯源
   */
  constructor(sessionId: string) {
    super({
      initialState: SessionState.IDLE,
      rules: SESSION_TRANSITIONS,
      contextId: sessionId,
    });
  }

  // ============================================================
  // 便捷方法
  // ============================================================

  /**
   * 启动会话：IDLE → RUNNING
   */
  start(reason?: string): boolean {
    return this.transition(SessionState.RUNNING, reason);
  }

  /**
   * 需要用户操作：RUNNING → REQUIRES_ACTION
   */
  requireAction(details: RequiresActionDetails): boolean {
    return this.transition(SessionState.REQUIRES_ACTION, details.action_description, {
      tool_name: details.tool_name,
      tool_use_id: details.tool_use_id,
      request_id: details.request_id,
      input: details.input,
    });
  }

  /**
   * 恢复执行：REQUIRES_ACTION/PAUSED → RUNNING
   *
   * 当前状态必须是 REQUIRES_ACTION 或 PAUSED，否则抛出 IllegalTransitionError。
   * 调用方应先通过 getState() 检查当前状态，或在 try/catch 中处理异常。
   */
  resume(reason?: string): boolean {
    return this.transition(SessionState.RUNNING, reason);
  }

  /**
   * 暂停：RUNNING/REQUIRES_ACTION → PAUSED
   */
  pause(reason?: string): boolean {
    return this.transition(SessionState.PAUSED, reason);
  }

  /**
   * 完成：RUNNING → COMPLETED
   */
  complete(reason?: string): boolean {
    return this.transition(SessionState.COMPLETED, reason);
  }

  /**
   * 结束本轮处理回到空闲：RUNNING → IDLE
   *
   * 与 complete() 不同，finish 不结束会话生命周期，而是将状态重置回 IDLE，
   * 允许下一轮 start()。适用于单个会话中多轮"开始处理→处理完成"的循环。
   */
  finish(reason?: string): boolean {
    return this.transition(SessionState.IDLE, reason);
  }

  /**
   * 错误：RUNNING/REQUIRES_ACTION → ERROR
   *
   * 将 Error.message 作为 reason、Error.stack 和 Error.name 作为 metadata 传入，
   * 保留完整错误信息便于调试。
   */
  error(err: Error): boolean {
    return this.transition(SessionState.ERROR, err.message, {
      stack: err.stack,
      name: err.name,
    });
  }

  /**
   * 中止：→ ABORTED
   *
   * 可从绝大多数非终态转移到 ABORTED。
   */
  abort(reason?: string): boolean {
    return this.transition(SessionState.ABORTED, reason);
  }

  /**
   * 归档：COMPLETED → ARCHIVED
   */
  archive(reason?: string): boolean {
    return this.transition(SessionState.ARCHIVED, reason);
  }

  // ============================================================
  // 状态查询
  // ============================================================

  /**
   * 是否空闲可开始新任务
   */
  canStart(): boolean {
    return this.getState() === SessionState.IDLE;
  }

  /**
   * 是否有待处理的用户操作
   */
  hasPendingAction(): boolean {
    return this.getState() === SessionState.REQUIRES_ACTION;
  }
}
