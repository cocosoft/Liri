/**
 * StreamStateMachine - 流状态机
 *
 * 管理流生命周期：IDLE → STREAMING → PAUSED → STREAMING → ... → COMPLETED / ERROR / CANCELLED
 *
 * 继承自 StateMachine<StreamState> 泛型引擎，提供完整的状态转换校验、
 * 监听器通知和转换历史记录能力。
 */

import { StateMachine } from '../state/engine/StateMachine';
import type { TransitionRules, TransitionRecord } from '../state/engine/types';
import { StreamState } from './types';

/**
 * 状态转换规则表
 * 定义哪些转换是合法的，使用 TransitionRules<StreamState> 格式
 */
const STREAM_TRANSITIONS: TransitionRules<StreamState> = {
  [StreamState.IDLE]: [StreamState.STREAMING],
  [StreamState.STREAMING]: [
    StreamState.PAUSED,
    StreamState.COMPLETED,
    StreamState.ERROR,
    StreamState.CANCELLED,
  ],
  [StreamState.PAUSED]: [
    StreamState.STREAMING,
    StreamState.CANCELLED,
    StreamState.COMPLETED,
  ],
  [StreamState.COMPLETED]: [StreamState.IDLE],
  [StreamState.ERROR]: [StreamState.IDLE, StreamState.STREAMING],
  [StreamState.CANCELLED]: [StreamState.IDLE],
};

/**
 * 状态转换历史记录条目
 *
 * @deprecated 使用 {@link TransitionRecord} — 从 `@modules/state/engine` 导入
 */
export interface StateTransitionRecord {
  from: StreamState;
  to: StreamState;
  reason?: string;
  timestamp: number;
}

/**
 * 状态变更监听器
 *
 * @deprecated 使用 {@link import('@modules/state/engine').StateChangeListener} — 从 `@modules/state/engine` 导入
 */
export type StateChangeListener = (
  from: StreamState,
  to: StreamState,
  reason?: string
) => void;

export class StreamStateMachine extends StateMachine<StreamState> {
  /**
   * @param streamId - 关联的流 ID，用于日志标识和上下文追踪
   */
  constructor(streamId: string = 'unknown') {
    super({
      initialState: StreamState.IDLE,
      rules: STREAM_TRANSITIONS,
      isTerminal: (state) =>
        state === StreamState.COMPLETED ||
        state === StreamState.ERROR ||
        state === StreamState.CANCELLED,
      isActive: (state) => state === StreamState.STREAMING,
      contextId: streamId,
    });
  }

  /**
   * 获取流 ID
   */
  getStreamId(): string {
    return this.getContextId();
  }

  /**
   * 转换到 STREAMING 状态
   */
  start(reason?: string): boolean {
    return this.transition(StreamState.STREAMING, reason);
  }

  /**
   * 转换到 PAUSED 状态
   */
  pause(reason?: string): boolean {
    return this.transition(StreamState.PAUSED, reason);
  }

  /**
   * 转换到 STREAMING 状态（从 PAUSED 恢复）
   */
  resume(reason?: string): boolean {
    return this.transition(StreamState.STREAMING, reason);
  }

  /**
   * 转换到 COMPLETED 状态
   */
  complete(reason?: string): boolean {
    return this.transition(StreamState.COMPLETED, reason);
  }

  /**
   * 转换到 ERROR 状态
   */
  error(reason?: string): boolean {
    return this.transition(StreamState.ERROR, reason);
  }

  /**
   * 转换到 CANCELLED 状态
   */
  cancel(reason?: string): boolean {
    return this.transition(StreamState.CANCELLED, reason);
  }

  /**
   * 重置到 IDLE 状态并清空历史记录
   */
  reset(reason?: string): boolean {
    const result = this.transition(StreamState.IDLE, reason);
    if (result) {
      this.history = [];
    }
    return result;
  }

  /**
   * 注册状态变更监听器
   *
   * @deprecated 使用 {@link onStateChange} — 功能相同，命名更一致
   * @returns 取消监听的函数
   */
  addListener(listener: StateChangeListener): () => void {
    return this.onStateChange(listener);
  }

  /**
   * 移除状态变更监听器
   *
   * @deprecated 使用 {@link offStateChange} — 功能相同，命名更一致
   */
  removeListener(listener: StateChangeListener): void {
    this.offStateChange(listener);
  }

  /**
   * 获取从开始到现在的总耗时（ms）
   */
  getElapsedMs(): number {
    const records = this.getHistory();
    if (records.length === 0) return 0;
    const first = records[0];
    return Date.now() - first.timestamp;
  }
}
