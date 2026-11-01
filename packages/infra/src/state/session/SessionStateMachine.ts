/**
 * SessionStateMachine — 会话状态机（**3 态**，阶段 3 / 2026-10-12）
 *
 * 管理单个会话的生命周期，提供严格的状态转移校验和便捷方法。
 * 替代已移除的 ChatSessionStateManager 和 SessionStateService。
 *
 * **阶段 3 变更（8 态 → 3 态）**：状态集与转移表收敛为 `../session/types` 的
 * `SESSION_TRANSITIONS`（`idle`/`running`/`requires_action`）。折叠映射与降级代价见该文件头注。
 * 便捷方法的目标态按折叠映射归并（如 `pause()`/`error()` 同指 `requires_action`），
 * 且引擎对 `from === to` 视为**幂等无操作**（不抛）⇒ 归并后"同目标再触发"不新增异常面。
 */

import { StateMachine } from '../engine/StateMachine';
import { SESSION_TRANSITIONS } from './types';
import type { RequiresActionDetails, SimplifiedSessionState } from './types';

export { SESSION_TRANSITIONS };
export type { RequiresActionDetails, SimplifiedSessionState };

export class SessionStateMachine extends StateMachine<SimplifiedSessionState> {
  /**
   * @param sessionId 会话 ID，作为 contextId 用于日志溯源
   */
  constructor(sessionId: string) {
    super({
      initialState: 'idle',
      rules: SESSION_TRANSITIONS,
      contextId: sessionId,
      // P2-32 修复：进入关键状态至少 warn 的分级告警（原 `criticalStates` 未配置 → 空 Set，
      // 关键转移只打 debug）。阶段 3 归并：旧 `[ERROR, PAUSED]` 二者在 3 态下**同为**
      // `requires_action` ⇒ 收敛为单值（"需要人介入"即关键态）。
      criticalStates: ['requires_action'],
    });
  }

  // ============================================================
  // 便捷方法（目标态按 8→3 折叠映射归并）
  // ============================================================

  /**
   * 启动会话：`idle → running`
   */
  start(reason?: string): boolean {
    return this.transition('running', reason);
  }

  /**
   * 需要用户操作：`running → requires_action`
   */
  requireAction(details: RequiresActionDetails): boolean {
    return this.transition('requires_action', details.action_description, {
      tool_name: details.tool_name,
      tool_use_id: details.tool_use_id,
      request_id: details.request_id,
      input: details.input,
    });
  }

  /**
   * 恢复执行：`requires_action → running`
   *
   * 当前状态必须是 `requires_action`，否则按规则表判定（非法转移抛 `IllegalTransitionError`）。
   * 旧 8 态下 `PAUSED → RUNNING` 亦走本方法（`PAUSED` 已折叠为 `requires_action`）。
   */
  resume(reason?: string): boolean {
    return this.transition('running', reason);
  }

  /**
   * 暂停：`running → requires_action`（旧 `PAUSED` 折叠目标）
   *
   * ⚠️ 3 态下 `PAUSED` 无独立取值 ⇒ 与 `requireAction()` 同目标；
   * 已在 `requires_action` 时再次 `pause()` 属引擎级**幂等无操作**（返回 `true`，不抛）。
   */
  pause(reason?: string): boolean {
    return this.transition('requires_action', reason);
  }

  /**
   * 完成：`running → idle`（旧 `COMPLETED` 折叠目标）
   *
   * ⚠️ 3 态下与 `finish()` **同义**（均回 `idle`）。保留两个入口是为了不打散既有调用方
   * （`SessionStateBridge` 用 `complete()`、`ChatManager`/`ChatOrchestrator` 用 `finish()`）。
   */
  complete(reason?: string): boolean {
    return this.transition('idle', reason);
  }

  /**
   * 结束本轮处理回到空闲：`running → idle`
   *
   * 与 `complete()` 同目标（见上）；语义侧重"单会话内多轮循环"（回到 `idle` 后可再次 `start()`）。
   */
  finish(reason?: string): boolean {
    return this.transition('idle', reason);
  }

  /**
   * 错误：`running/requires_action → requires_action`（旧 `ERROR` 折叠目标）
   *
   * 将 `Error.message` 作为 reason、`Error.stack` 和 `Error.name` 作为 metadata 传入，
   * 保留完整错误信息便于调试。
   */
  error(err: Error): boolean {
    return this.transition('requires_action', err.message, {
      stack: err.stack,
      name: err.name,
    });
  }

  /**
   * 中止：`running/requires_action → idle`（旧 `ABORTED` 折叠目标）
   */
  abort(reason?: string): boolean {
    return this.transition('idle', reason);
  }

  // 说明（阶段 3）：旧 `archive()`（`COMPLETED → ARCHIVED`）**已删除** ——
  //   ① 3 态下 `ARCHIVED` 折叠为 `idle`，与 `complete()/abort()` **无区分**（无独立目标态）；
  //   ② 生产**零调用者**（`SessionStateBridge` 的 `session:archived` 分支本就调 `complete()`）。
  //   回滚路径：见 `dev_docs/20261012/状态机规范管理方案-20261012.md` §4 阶段 3。

  // ============================================================
  // 状态查询
  // ============================================================

  /**
   * 是否空闲可开始新任务
   */
  canStart(): boolean {
    return this.getState() === 'idle';
  }

  /**
   * 是否有待处理的用户操作
   */
  hasPendingAction(): boolean {
    return this.getState() === 'requires_action';
  }
}
