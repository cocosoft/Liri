/**
 * StreamStateMachine - 流状态机
 *
 * 管理流生命周期：IDLE → STREAMING → PAUSED → STREAMING → ... → COMPLETED / ERROR / CANCELLED
 * 提供状态转换验证、监听器通知和转换历史记录。
 */

import { Logger } from '@modules/monitoring/logs/Logger';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error/types';
import { StreamState, type StreamStateTransition } from './types';

const logger = new Logger('StreamStateMachine');

/**
 * 状态转换规则表
 * 定义哪些转换是合法的
 */
const VALID_TRANSITIONS: Record<StreamState, Set<StreamState>> = {
  [StreamState.IDLE]: new Set([StreamState.STREAMING]),
  [StreamState.STREAMING]: new Set([
    StreamState.PAUSED,
    StreamState.COMPLETED,
    StreamState.ERROR,
    StreamState.CANCELLED,
  ]),
  [StreamState.PAUSED]: new Set([
    StreamState.STREAMING,
    StreamState.CANCELLED,
    StreamState.COMPLETED,
  ]),
  [StreamState.COMPLETED]: new Set([StreamState.IDLE]),
  [StreamState.ERROR]: new Set([StreamState.IDLE, StreamState.STREAMING]),
  [StreamState.CANCELLED]: new Set([StreamState.IDLE]),
};

/**
 * 状态转换历史记录条目
 */
export interface StateTransitionRecord {
  from: StreamState;
  to: StreamState;
  reason?: string;
  timestamp: number;
}

/**
 * 状态变更监听器
 */
export type StateChangeListener = (
  from: StreamState,
  to: StreamState,
  reason?: string
) => void;

export class StreamStateMachine {
  private currentState: StreamState = StreamState.IDLE;
  private history: StateTransitionRecord[] = [];
  private listeners: Set<StateChangeListener> = new Set();
  private streamId: string;

  /**
   * @param streamId - 关联的流 ID，用于日志标识
   */
  constructor(streamId: string = 'unknown') {
    this.streamId = streamId;
  }

  /**
   * 获取当前状态
   */
  getState(): StreamState {
    return this.currentState;
  }

  /**
   * 获取流 ID
   */
  getStreamId(): string {
    return this.streamId;
  }

  /**
   * 获取转换历史（不可变快照）
   */
  getHistory(): readonly StateTransitionRecord[] {
    return [...this.history];
  }

  /**
   * 获取当前状态是否处于活跃（可接收数据）状态
   */
  isActive(): boolean {
    return this.currentState === StreamState.STREAMING;
  }

  /**
   * 获取当前状态是否处于终止状态
   */
  isTerminal(): boolean {
    return (
      this.currentState === StreamState.COMPLETED ||
      this.currentState === StreamState.ERROR ||
      this.currentState === StreamState.CANCELLED
    );
  }

  /**
   * 尝试执行状态转换
   *
   * @param to - 目标状态
   * @param reason - 转换原因（可选）
   * @returns 转换是否成功
   */
  transition(to: StreamState, reason?: string): boolean {
    const from = this.currentState;

    if (from === to) {
      logger.debug(`状态未变: ${from}`, { streamId: this.streamId });
      return true;
    }

    const allowed = VALID_TRANSITIONS[from];
    if (!allowed || !allowed.has(to)) {
      throw new AppError(
        `非法状态转换: ${from} → ${to}`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000',
        { streamId: this.streamId, from, to }
      );
    }

    this.currentState = to;

    const record: StateTransitionRecord = {
      from,
      to,
      reason,
      timestamp: Date.now(),
    };
    this.history.push(record);

    logger.debug(`状态转换: ${from} → ${to}`, {
      streamId: this.streamId,
      reason,
    });

    this.notifyListeners(from, to, reason);
    return true;
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
   * 重置到 IDLE 状态
   */
  reset(reason?: string): boolean {
    const result = this.transition(StreamState.IDLE, reason);
    if (result) {
      this.history = [];
    }
    return result;
  }

  /**
   * 检查指定转换是否合法
   */
  canTransition(to: StreamState): boolean {
    const allowed = VALID_TRANSITIONS[this.currentState];
    return allowed ? allowed.has(to) : false;
  }

  /**
   * 注册状态变更监听器
   *
   * @returns 取消监听的函数
   */
  addListener(listener: StateChangeListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * 移除状态变更监听器
   */
  removeListener(listener: StateChangeListener): void {
    this.listeners.delete(listener);
  }

  /**
   * 通知所有监听器
   */
  private notifyListeners(
    from: StreamState,
    to: StreamState,
    reason?: string
  ): void {
    for (const listener of this.listeners) {
      try {
        listener(from, to, reason);
      } catch (err) {
        logger.error('状态变更监听器抛出异常', err as Error, {
          streamId: this.streamId,
          from,
          to,
        });
      }
    }
  }

  /**
   * 获取从开始到现在的总耗时（ms）
   */
  getElapsedMs(): number {
    if (this.history.length === 0) return 0;
    const first = this.history[0];
    return Date.now() - first.timestamp;
  }
}
