// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * TrackedTool — 工具调用状态机
 *
 * P1-12: 对标 PilotDeck StreamingToolExecutor 的 TrackedTool wrapper。
 * 为每个工具调用提供显式状态追踪，替代简单的布尔/配置标志位。
 *
 * 状态转换图：
 *   queued → executing → completed
 *                      → failed
 *                      → aborted
 *                      → timed_out
 *
 * 所有终端状态（completed/failed/aborted/timed_out）不可逆转。
 * 非法状态转换会触发 logger.warning 但不抛异常（非关键路径）。
 */

import { Logger } from '@modules/monitoring';

const logger = new Logger({ module: 'query:trackedTool' });

// ============================================================
// State Enum
// ============================================================

/** 工具调用状态 */
export enum TrackedToolState {
  /** 已入队，等待执行 */
  QUEUED = 'queued',
  /** 正在执行 */
  EXECUTING = 'executing',
  /** 执行成功 */
  COMPLETED = 'completed',
  /** 执行失败 */
  FAILED = 'failed',
  /** 被级联中止 */
  ABORTED = 'aborted',
  /** 超时 */
  TIMED_OUT = 'timed_out',
}

/** 终端状态集合 */
const TERMINAL_STATES: Set<TrackedToolState> = new Set([
  TrackedToolState.COMPLETED,
  TrackedToolState.FAILED,
  TrackedToolState.ABORTED,
  TrackedToolState.TIMED_OUT,
]);

// ============================================================
// Types
// ============================================================

/** 追踪事件的回调 */
export type TrackedToolCallback = (tool: TrackedTool) => void;

/** 工具调用结果 */
export interface TrackedToolResult {
  toolCallId: string;
  toolName: string;
  state: TrackedToolState;
  result?: unknown;
  error?: string;
  durationMs: number;
}

// ============================================================
// TrackedTool
// ============================================================

export class TrackedTool {
  /** 工具调用 ID */
  readonly toolCallId: string;
  /** 工具名称 */
  readonly toolName: string;
  /** 工具参数 */
  readonly arguments: Record<string, unknown>;

  /** 当前状态 */
  private _state: TrackedToolState = TrackedToolState.QUEUED;
  /** 执行结果 */
  private _result: unknown;
  /** 错误信息 */
  private _error: string | undefined;

  /** 时间戳 */
  private _queuedAt: number;
  private _startedAt: number = 0;
  private _completedAt: number = 0;

  /** 状态变更回调 */
  private onStateChange: TrackedToolCallback | null = null;

  constructor(
    toolCallId: string,
    toolName: string,
    args: Record<string, unknown> = {}
  ) {
    this.toolCallId = toolCallId;
    this.toolName = toolName;
    this.arguments = args;
    this._queuedAt = Date.now();
  }

  // ── 属性 ──────────────────────────────────────────

  get state(): TrackedToolState {
    return this._state;
  }

  get result(): unknown {
    return this._result;
  }

  get error(): string | undefined {
    return this._error;
  }

  get queuedAt(): number {
    return this._queuedAt;
  }

  get startedAt(): number {
    return this._startedAt;
  }

  get completedAt(): number {
    return this._completedAt;
  }

  /** 是否为终端状态 */
  get isTerminal(): boolean {
    return TERMINAL_STATES.has(this._state);
  }

  /** 是否正在执行 */
  get isActive(): boolean {
    return (
      this._state === TrackedToolState.QUEUED ||
      this._state === TrackedToolState.EXECUTING
    );
  }

  /** 执行耗时（毫秒） */
  get durationMs(): number {
    if (this._startedAt === 0) return 0;
    const end = this._completedAt || Date.now();
    return end - this._startedAt;
  }

  /** 排队等待时长（毫秒） */
  get queueWaitMs(): number {
    if (this._startedAt === 0) return Date.now() - this._queuedAt;
    return this._startedAt - this._queuedAt;
  }

  // ── 状态转换 ──────────────────────────────────────

  /** 设置状态变更回调 */
  setOnStateChange(cb: TrackedToolCallback): void {
    this.onStateChange = cb;
  }

  /** 标记为执行中 */
  markExecuting(): void {
    this.transition(TrackedToolState.EXECUTING);
    this._startedAt = Date.now();
  }

  /** 标记为执行成功 */
  markCompleted(result: unknown): void {
    this._result = result;
    this.transition(TrackedToolState.COMPLETED);
    this._completedAt = Date.now();
  }

  /** 标记为执行失败 */
  markFailed(error: string): void {
    this._error = error;
    this.transition(TrackedToolState.FAILED);
    this._completedAt = Date.now();
  }

  /** 标记为被中止 */
  markAborted(reason: string = 'aborted by cascade signal'): void {
    this._error = reason;
    this.transition(TrackedToolState.ABORTED);
    this._completedAt = Date.now();
  }

  /** 标记为超时 */
  markTimedOut(timeoutMs: number): void {
    this._error = `timed out after ${timeoutMs}ms`;
    this.transition(TrackedToolState.TIMED_OUT);
    this._completedAt = Date.now();
  }

  /** 导出结果 */
  toResult(): TrackedToolResult {
    return {
      toolCallId: this.toolCallId,
      toolName: this.toolName,
      state: this._state,
      result: this.isTerminal ? this._result : undefined,
      error: this._error,
      durationMs: this.durationMs,
    };
  }

  // ── 内部 ──────────────────────────────────────────

  private transition(newState: TrackedToolState): void {
    // 防止从终端状态再次转换
    if (this.isTerminal) {
      logger.warn('TrackedTool: illegal transition from terminal state', {
        toolCallId: this.toolCallId,
        toolName: this.toolName,
        from: this._state,
        to: newState,
      });
      return;
    }

    // 合法转换校验
    const validTransitions: Record<TrackedToolState, TrackedToolState[]> = {
      [TrackedToolState.QUEUED]: [TrackedToolState.EXECUTING],
      [TrackedToolState.EXECUTING]: [
        TrackedToolState.COMPLETED,
        TrackedToolState.FAILED,
        TrackedToolState.ABORTED,
        TrackedToolState.TIMED_OUT,
      ],
      [TrackedToolState.COMPLETED]: [],
      [TrackedToolState.FAILED]: [],
      [TrackedToolState.ABORTED]: [],
      [TrackedToolState.TIMED_OUT]: [],
    };

    if (!validTransitions[this._state].includes(newState)) {
      logger.warn('TrackedTool: invalid state transition', {
        toolCallId: this.toolCallId,
        toolName: this.toolName,
        from: this._state,
        to: newState,
      });
      return;
    }

    this._state = newState;
    this.onStateChange?.(this);
  }
}
