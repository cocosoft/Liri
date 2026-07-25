/**
 * calendar 模块类型定义
 */

/** 事件状态枚举 */
export enum EventStatus {
  PENDING = 'pending',
  IN_PROGRESS = 'in_progress',
  COMPLETED = 'completed',
  CANCELLED = 'cancelled',
  OVERDUE = 'overdue',
}

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
  /** 事件状态（默认 pending） */
  status: EventStatus;
  /** 状态变更时间（ISO 8601） */
  statusUpdatedAt?: string;
  /** 完成时间（从 pending → completed 时设置） */
  completedAt?: string;
  /** 优先级 1-5 */
  priority?: number;
  /** 标签 */
  tags?: string[];
  /** 提醒分钟数数组 */
  reminderMinutes?: number[];
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
  /** 事件状态（默认 pending） */
  status?: EventStatus;
  /** 优先级 1-5 */
  priority?: number;
  /** 标签 */
  tags?: string[];
}

/** 日历模块状态 */
export enum CalendarModuleStatus {
  UNINITIALIZED = 'uninitialized',
  READY = 'ready',
  DEGRADED = 'degraded',
  SHUTDOWN = 'shutdown',
}
