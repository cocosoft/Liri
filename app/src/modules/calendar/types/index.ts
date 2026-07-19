/**
 * calendar 模块类型定义
 */

/** 日历事件 */
export interface CalendarEvent {
  id: string;
  summary: string;
  start: string; // ISO 8601
  end: string; // ISO 8601
  description?: string;
  location?: string;
  allDay?: boolean;
  recurrence?: string; // RRULE
  attendees?: string[];
  meeting?: {
    agenda?: string;
    minutes?: string;
    actionItems?: string[];
  };
}

/** 日历添加参数 */
export interface CalendarAddArgs {
  summary: string;
  start: string;
  end: string;
  description?: string;
  location?: string;
  reminder?: {
    minutesBefore: number;
    method: 'push' | 'log';
  };
  /** 多提醒支持：提前分钟数数组，如 [15, 1440] 表示15分钟前和1天前 */
  reminderMinutes?: number[];
  /** AI 对话片段（静态摘要） */
  snippet?: string;
  /** 对话会话 ID（AI 创建时传入） */
  sessionId?: string;
  /** 工具调用 ID */
  toolCallId?: string;
}

/** 日历模块状态 */
export enum CalendarModuleStatus {
  UNINITIALIZED = 'uninitialized',
  READY = 'ready',
  DEGRADED = 'degraded',
  SHUTDOWN = 'shutdown',
}
