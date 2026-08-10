/**
 * CalendarEventBus — 日历模块专用事件总线
 * 基于全局 EventBusImpl 的轻量实例，用于日历事件的发布-订阅
 */

import { EventBusImpl } from '@modules/core/events/EventBus';
import { getLogger } from '@modules/monitoring';
const logger = getLogger('calendar:eventBus');

/** 日历事件类型 */
export const CalendarEvents = {
  /** 日历事件创建 */
  EVENT_CREATED: 'calendar:event:created',
  /** 日历事件更新 */
  EVENT_UPDATED: 'calendar:event:updated',
  /** 日历事件删除 */
  EVENT_DELETED: 'calendar:event:deleted',
  /** Cron 任务状态变更 */
  CRON_STATE_CHANGED: 'calendar:cron:state_changed',
} as const;

/** 日历事件创建载荷 */
export interface CalendarEventCreatedPayload {
  event: {
    id: string;
    summary: string;
    start: string;
    end: string;
    description?: string;
    location?: string;
  };
  sessionId?: string;
  toolCallId?: string;
  snippet?: string;
  reminderMinutes?: number[];
}

/** 日历事件更新载荷 */
export interface CalendarEventUpdatedPayload {
  prevEvent: {
    id: string;
    summary: string;
    start: string;
    end: string;
  };
  newEvent: {
    id: string;
    summary: string;
    start: string;
    end: string;
  };
}

/** 日历事件删除载荷 */
export interface CalendarEventDeletedPayload {
  id: string;
  summary: string;
}

/** Cron 状态变更载荷 */
export interface CronStateChangedPayload {
  jobId: string;
  newState: string;
}

/** 日历事件总线单例 */
let calendarEventBus: EventBusImpl | null = null;

/**
 * 获取日历事件总线实例（单例）
 */
export function getCalendarEventBus(): EventBusImpl {
  if (!calendarEventBus) {
    calendarEventBus = new EventBusImpl();
    logger.info('CalendarEventBus 已创建');
  }
  return calendarEventBus;
}
