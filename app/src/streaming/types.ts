/**
 * 流式输出模块类型定义
 *
 * 包含 15+ 种事件类型，覆盖流生命周期、工具调用、进度控制和性能指标。
 */

// ============================================================
// 事件类型枚举
// ============================================================

export type StreamEventType =
  // 现有 - 内容块事件
  | 'content_block_delta'
  | 'content_block_start'
  | 'content_block_stop'
  // 现有 - 消息事件
  | 'message_start'
  | 'message_delta'
  | 'message_stop'
  // 新增 - 流生命周期
  | 'start' // 流开始
  | 'token' // 单 token 粒度
  | 'progress' // 整体进度百分比
  | 'done' // 流完成（含最终统计）
  // 新增 - 流控制
  | 'yield' // 流让出控制权
  | 'pause' // 流暂停
  | 'resume' // 流恢复
  | 'cancel' // 流取消
  // 新增 - 性能指标
  | 'metrics' // 性能指标（周期性）
  // 新增 - 工具调用
  | 'tool_start' // 工具调用开始
  | 'tool_end' // 工具调用结束
  | 'tool_progress'; // 工具调用进度

// ============================================================
// 流生命周期事件
// ============================================================

export interface StreamStartEvent {
  type: 'start';
  streamId: string;
  model: string;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

export interface StreamTokenEvent {
  type: 'token';
  token: string;
  index: number;
  timestamp: number;
}

export interface StreamProgressEvent {
  type: 'progress';
  percent: number;
  current: number;
  total: number;
  timestamp: number;
}

export interface StreamDoneEvent {
  type: 'done';
  streamId: string;
  totalTokens: number;
  totalDuration: number;
  tokenSpeed: number;
  timestamp: number;
}

// ============================================================
// 流控制事件
// ============================================================

export interface StreamYieldEvent {
  type: 'yield';
  reason: string;
  timestamp: number;
}

export interface StreamPauseEvent {
  type: 'pause';
  reason?: string;
  timestamp: number;
}

export interface StreamResumeEvent {
  type: 'resume';
  reason?: string;
  timestamp: number;
}

export interface StreamCancelEvent {
  type: 'cancel';
  reason?: string;
  timestamp: number;
}

// ============================================================
// 性能指标事件
// ============================================================

export interface StreamMetricsEvent {
  type: 'metrics';
  tokenCount: number;
  speed: number;
  estimatedCost?: number;
  elapsedMs: number;
  timestamp: number;
}

// ============================================================
// 工具调用事件
// ============================================================

export interface StreamToolStartEvent {
  type: 'tool_start';
  toolCallId: string;
  toolName: string;
  arguments: string;
  timestamp: number;
}

export interface StreamToolEndEvent {
  type: 'tool_end';
  toolCallId: string;
  toolName: string;
  result?: string;
  duration: number;
  timestamp: number;
}

export interface StreamToolProgressEvent {
  type: 'tool_progress';
  toolCallId: string;
  toolName: string;
  progress: number;
  message?: string;
  timestamp: number;
}

// ============================================================
// 统一的 StreamEvent 联合类型
// ============================================================

export type StreamEvent =
  // 现有内容块事件
  | {
      type: 'content_block_delta';
      index?: number;
      delta?: {
        type: 'text_delta' | 'input_json_delta';
        text?: string;
        partial_json?: string;
      };
    }
  | {
      type: 'content_block_start';
      index?: number;
      content_block?: {
        type: 'text' | 'tool_use';
        text?: string;
        id?: string;
        name?: string;
        input?: unknown;
      };
    }
  | { type: 'content_block_stop'; index?: number }
  // 现有消息事件
  | {
      type: 'message_start';
      message?: {
        id: string;
        role: 'assistant';
        content: unknown[];
        model: string;
      };
    }
  | {
      type: 'message_delta';
      delta?: { type: 'text_delta' };
      usage?: { prompt_tokens: number; completion_tokens: number };
    }
  | {
      type: 'message_stop';
      usage?: { prompt_tokens: number; completion_tokens: number };
    }
  // 新增事件
  | StreamStartEvent
  | StreamTokenEvent
  | StreamProgressEvent
  | StreamDoneEvent
  | StreamYieldEvent
  | StreamPauseEvent
  | StreamResumeEvent
  | StreamCancelEvent
  | StreamMetricsEvent
  | StreamToolStartEvent
  | StreamToolEndEvent
  | StreamToolProgressEvent;

// ============================================================
// StreamChunk 类型
// ============================================================

export interface StreamChunk {
  content: string;
  isComplete: boolean;
  toolCalls?: {
    id: string;
    name: string;
    arguments: string;
    isComplete: boolean;
  }[];
  /** 流指标（done 事件时携带） */
  metrics?: {
    totalTokens: number;
    totalDuration: number;
    tokenSpeed: number;
  };
  /** 进度信息（progress 事件时携带） */
  progress?: {
    percent: number;
    current: number;
    total: number;
  };
  /** 是否被暂停 */
  isPaused?: boolean;
  /** 工具调用 ID（tool_start/tool_end/tool_progress 事件时携带） */
  toolCallId?: string;
  /** 工具名称（tool_start/tool_end/tool_progress 事件时携带） */
  toolName?: string;
}

// ============================================================
// 回调类型
// ============================================================

export type StreamCallback = (chunk: StreamChunk) => void;

export type StreamEventCallback = (event: StreamEvent) => void;

// ============================================================
// 流状态枚举
// ============================================================

export enum StreamState {
  IDLE = 'idle',
  STREAMING = 'streaming',
  PAUSED = 'paused',
  COMPLETED = 'completed',
  ERROR = 'error',
  CANCELLED = 'cancelled',
}

// ============================================================
// StreamStateMachine 接口
// ============================================================

export type StreamStateTransition =
  | { from: StreamState.IDLE; to: StreamState.STREAMING }
  | { from: StreamState.STREAMING; to: StreamState.PAUSED }
  | { from: StreamState.STREAMING; to: StreamState.COMPLETED }
  | { from: StreamState.STREAMING; to: StreamState.ERROR }
  | { from: StreamState.STREAMING; to: StreamState.CANCELLED }
  | { from: StreamState.PAUSED; to: StreamState.STREAMING }
  | { from: StreamState.PAUSED; to: StreamState.CANCELLED }
  | { from: StreamState.PAUSED; to: StreamState.COMPLETED }
  | { from: StreamState.ERROR; to: StreamState.IDLE }
  | { from: StreamState.COMPLETED; to: StreamState.IDLE }
  | { from: StreamState.CANCELLED; to: StreamState.IDLE };

// ============================================================
// 类型守卫
// ============================================================

export function isStreamStartEvent(
  event: StreamEvent
): event is StreamStartEvent {
  return event.type === 'start';
}

export function isStreamTokenEvent(
  event: StreamEvent
): event is StreamTokenEvent {
  return event.type === 'token';
}

export function isStreamProgressEvent(
  event: StreamEvent
): event is StreamProgressEvent {
  return event.type === 'progress';
}

export function isStreamDoneEvent(
  event: StreamEvent
): event is StreamDoneEvent {
  return event.type === 'done';
}

export function isStreamYieldEvent(
  event: StreamEvent
): event is StreamYieldEvent {
  return event.type === 'yield';
}

export function isStreamPauseEvent(
  event: StreamEvent
): event is StreamPauseEvent {
  return event.type === 'pause';
}

export function isStreamResumeEvent(
  event: StreamEvent
): event is StreamResumeEvent {
  return event.type === 'resume';
}

export function isStreamCancelEvent(
  event: StreamEvent
): event is StreamCancelEvent {
  return event.type === 'cancel';
}

export function isStreamMetricsEvent(
  event: StreamEvent
): event is StreamMetricsEvent {
  return event.type === 'metrics';
}

export function isStreamToolStartEvent(
  event: StreamEvent
): event is StreamToolStartEvent {
  return event.type === 'tool_start';
}

export function isStreamToolEndEvent(
  event: StreamEvent
): event is StreamToolEndEvent {
  return event.type === 'tool_end';
}

export function isStreamToolProgressEvent(
  event: StreamEvent
): event is StreamToolProgressEvent {
  return event.type === 'tool_progress';
}
