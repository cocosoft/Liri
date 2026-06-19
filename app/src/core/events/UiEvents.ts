/**
 * UiEvents — UI 事件类型定义
 *
 * 用于 app → ui 跨层通信的事件类型和负载定义。
 * app 层模块发布事件，ui 层订阅并渲染。
 * 遵循 1:N 事件解耦模式，消除 app → ui 的直接静态依赖。
 *
 * 命名规范：使用 `ui:` 前缀，格式为 `ui:<domain>:<action>`
 */

import type { EventListener, EventSubscription } from './EventBus';

// ==================== 工具 UI 事件 ====================

/** 工具执行输出行 */
export interface UiToolOutputEvent {
  /** 工具 ID */
  toolId: string;
  /** 工具名称 */
  toolName: string;
  /** 输出文本 */
  text: string;
  /** 输出类型 */
  type: 'stdout' | 'stderr' | 'progress' | 'result';
  /** 时间戳 */
  timestamp: number;
}

/** 工具执行状态变更 */
export interface UiToolStatusEvent {
  /** 工具 ID */
  toolId: string;
  /** 工具名称 */
  toolName: string;
  /** 新状态 */
  status: 'started' | 'running' | 'completed' | 'failed' | 'cancelled';
  /** 错误信息（失败时） */
  error?: string;
  /** 时间戳 */
  timestamp: number;
}

// ==================== Companion 事件 ====================

/** Companion 精灵更新 */
export interface UiCompanionEvent {
  /** 精灵文本/表情 */
  sprite?: string;
  /** 消息文本 */
  message?: string;
  /** 动作类型 */
  action: 'idle' | 'speak' | 'animate' | 'hide' | 'achievement';
  /** 持续时间（毫秒） */
  duration?: number;
}

// ==================== 通知事件 ====================

/** UI 通知 */
export interface UiNotificationEvent {
  /** 通知标题 */
  title: string;
  /** 通知内容 */
  message: string;
  /** 通知类型 */
  type: 'info' | 'success' | 'warning' | 'error';
  /** 持续时间（毫秒），默认 3000 */
  duration?: number;
  /** 通知 ID（自动生成时可不传） */
  id?: string;
}

// ==================== 命令/状态事件 ====================

/** 命令执行输出 */
export interface UiCommandOutputEvent {
  /** 命令名称 */
  command: string;
  /** 输出行 */
  line: string;
  /** 输出类型 */
  type: 'stdout' | 'stderr' | 'system';
  /** 时间戳 */
  timestamp: number;
}

/** 通用状态消息 */
export interface UiStatusMessageEvent {
  /** 状态文本 */
  message: string;
  /** 状态类型 */
  type: 'info' | 'success' | 'warning' | 'error' | 'progress';
  /** 进度百分比（progress 类型时有效） */
  progress?: number;
  /** 持续时间（毫秒） */
  duration?: number;
}

// ==================== 事件名称常量 ====================

/** UI 事件名称常量 */
export const UiEvents = {
  // 工具相关
  TOOL_OUTPUT: 'ui:tool:output',
  TOOL_STATUS: 'ui:tool:status',

  // Companion 相关
  COMPANION_UPDATE: 'ui:companion:update',

  // 通知相关
  NOTIFICATION: 'ui:notification',

  // 命令相关
  COMMAND_OUTPUT: 'ui:command:output',

  // 通用状态
  STATUS_MESSAGE: 'ui:status:message',
} as const;

// ==================== UI 事件映射表 ====================

/**
 * UI 事件名称到负载类型的映射
 * 用于 TypedEventBus 的类型安全路由
 */
export interface UiEventMap {
  [UiEvents.TOOL_OUTPUT]: UiToolOutputEvent;
  [UiEvents.TOOL_STATUS]: UiToolStatusEvent;
  [UiEvents.COMPANION_UPDATE]: UiCompanionEvent;
  [UiEvents.NOTIFICATION]: UiNotificationEvent;
  [UiEvents.COMMAND_OUTPUT]: UiCommandOutputEvent;
  [UiEvents.STATUS_MESSAGE]: UiStatusMessageEvent;
}

// ==================== UI 事件处理类型 ====================

/** UI 事件监听器类型 */
export type UiEventListener<T = unknown> = EventListener<T>;

/** UI 事件订阅类型 */
export type UiEventSubscription = EventSubscription;
