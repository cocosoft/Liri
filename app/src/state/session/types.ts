/**
 * 会话状态机类型定义
 *
 * 基于设计文档 5.1 节，从 SessionStatus 的 10 种状态精简为 8 种。
 * 去掉了冗余的 ACTIVE 和 ENDED。
 */

import type { TransitionRules } from '../engine/types';

/**
 * 会话状态枚举（8 状态，旧版）
 *
 * @deprecated 使用 {@link SimplifiedSessionState} 替代。
 * 三阶段迁移进度：
 *   Phase 1 ✅ — SimplifiedSessionState + toSimplifiedState() 已定义，并存
 *   Phase 2 ⏳ — 待 ChatManager 拆分后逐文件迁移消费方
 *   Phase 3 ⬜ — 全部迁移后删除此枚举
 */
export enum SessionState {
  /** 空闲 — 初始状态 */
  IDLE = 'idle',
  /** 运行中 — 正在执行任务 */
  RUNNING = 'running',
  /** 需要用户操作 — 等待用户输入 */
  REQUIRES_ACTION = 'requires_action',
  /** 已暂停 */
  PAUSED = 'paused',
  /** 已完成 */
  COMPLETED = 'completed',
  /** 出错 */
  ERROR = 'error',
  /** 已归档 — 终态 */
  ARCHIVED = 'archived',
  /** 已中止 — 终态 */
  ABORTED = 'aborted',
}

/**
 * 简化会话状态（对标 BA_REF 的 idle/running/requires_action）
 *
 * Phase 1 ✅: 新增类型，与旧 SessionState 枚举并存
 * Phase 2 ⏳: 逐步迁移消费方使用此类型（待 ChatManager 拆分后执行，受影响文件见迁移清单）
 * Phase 3 ⬜: 删除旧 SessionState 枚举中非核心状态
 *
 * 迁移清单（方案 Step 9）:
 *   - session/types/Session.ts
 *   - SessionStore.ts
 *   - SessionStateMachine.ts
 *   - SessionGateway.ts
 *   - core/session/SessionSupervisor.ts
 *   - state/engine/StateMachine.ts
 */
export type SimplifiedSessionState = 'idle' | 'running' | 'requires_action';

/**
 * 将旧 SessionState 映射为简化状态
 */
export function toSimplifiedState(state: SessionState): SimplifiedSessionState {
  switch (state) {
    case SessionState.IDLE:
    case SessionState.COMPLETED:
    case SessionState.ARCHIVED:
    case SessionState.ABORTED:
      return 'idle';
    case SessionState.RUNNING:
      return 'running';
    case SessionState.REQUIRES_ACTION:
    case SessionState.PAUSED:
    case SessionState.ERROR:
      return 'requires_action';
  }
}

/**
 * 待处理动作详情
 *
 * 当会话进入 REQUIRES_ACTION 状态时，描述需要用户做什么操作。
 */
export interface RequiresActionDetails {
  /** 需要用户确认的工具名称 */
  tool_name: string;
  /** 动作描述 */
  action_description: string;
  /** 工具调用 ID */
  tool_use_id: string;
  /** 请求 ID */
  request_id: string;
  /** 工具输入参数 */
  input?: Record<string, unknown>;
}

/**
 * 会话状态转移规则表
 *
 * 转移路径说明：
 * - IDLE → ABORTED：创建了会话但从未运行就直接废弃
 * - ERROR → RUNNING：错误后重试，保留上下文（如网络超时）
 * - ERROR → IDLE：错误后完全重置
 * - PAUSED → RUNNING：从暂停恢复执行
 */
export const SESSION_TRANSITIONS: TransitionRules<SessionState> = {
  [SessionState.IDLE]: [SessionState.RUNNING, SessionState.ABORTED],
  [SessionState.RUNNING]: [
    SessionState.IDLE,
    SessionState.REQUIRES_ACTION,
    SessionState.PAUSED,
    SessionState.ERROR,
    SessionState.COMPLETED,
    SessionState.ABORTED,
  ],
  [SessionState.REQUIRES_ACTION]: [
    SessionState.RUNNING,
    SessionState.PAUSED,
    SessionState.ERROR,
    SessionState.ABORTED,
  ],
  [SessionState.PAUSED]: [SessionState.RUNNING, SessionState.ABORTED],
  [SessionState.COMPLETED]: [SessionState.ARCHIVED],
  [SessionState.ERROR]: [
    SessionState.IDLE,
    SessionState.RUNNING,
    SessionState.ABORTED,
  ],
  [SessionState.ARCHIVED]: [],
  [SessionState.ABORTED]: [],
};
