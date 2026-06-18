/**
 * 会话状态机类型定义
 *
 * 基于设计文档 5.1 节，从 SessionStatus 的 10 种状态精简为 8 种。
 * 去掉了冗余的 ACTIVE 和 ENDED。
 */

import type { TransitionRules } from '../engine/types';

/**
 * 会话状态枚举
 *
 * 替代旧的 SessionStatus 枚举（在 session/types/Session.ts 中定义）。
 * 共 8 种状态，其中 ARCHIVED 和 ABORTED 为终态（出度为 0）。
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
  [SessionState.IDLE]:            [
    SessionState.RUNNING,
    SessionState.ABORTED,
  ],
  [SessionState.RUNNING]:         [
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
  [SessionState.PAUSED]:          [
    SessionState.RUNNING,
    SessionState.ABORTED,
  ],
  [SessionState.COMPLETED]:       [SessionState.ARCHIVED],
  [SessionState.ERROR]:           [
    SessionState.IDLE,
    SessionState.RUNNING,
    SessionState.ABORTED,
  ],
  [SessionState.ARCHIVED]:        [],
  [SessionState.ABORTED]:         [],
};
