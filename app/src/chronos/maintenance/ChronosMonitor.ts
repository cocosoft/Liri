/**
 * Chronos监控和日志模块
 * 用于追踪Chronos系统的事件和状态
 */

import { getLogger } from '@modules/monitoring';

const logger = getLogger('ChronosMonitor');

export enum ChronosEventType {
  TASK_CREATED = 'task_created',
  TASK_DELETED = 'task_deleted',
  TASK_EXECUTED = 'task_executed',
  TASK_FAILED = 'task_failed',
  TASK_MISSED = 'task_missed',
  LOCK_ACQUIRED = 'lock_acquired',
  LOCK_RELEASED = 'lock_released',
  LOCK_FAILED = 'lock_failed',
  DREAM_STARTED = 'dream_started',
  DREAM_COMPLETED = 'dream_completed',
  DREAM_FAILED = 'dream_failed',
  CLEANUP_STARTED = 'cleanup_started',
  CLEANUP_COMPLETED = 'cleanup_completed',
  HOUSEKEEPING_STARTED = 'housekeeping_started',
  HOUSEKEEPING_STOPPED = 'housekeeping_stopped',
}

export interface ChronosEvent {
  type: ChronosEventType;
  timestamp?: number;
  taskId?: string;
  cronExpression?: string;
  message?: string;
  error?: string;
  metadata?: Record<string, unknown>;
}

const eventLog: ChronosEvent[] = [];
const MAX_EVENT_LOG_SIZE = 1000;

export function logEvent(event: ChronosEvent): void {
  event.timestamp = Date.now();
  eventLog.push(event);

  if (eventLog.length > MAX_EVENT_LOG_SIZE) {
    eventLog.shift();
  }

  const level = getEventLevel(event.type);
  const message = formatEventMessage(event);
  logger.info('Chronos 事件', { level, message });
}

function getEventLevel(type: ChronosEventType): string {
  switch (type) {
    case ChronosEventType.TASK_FAILED:
    case ChronosEventType.LOCK_FAILED:
    case ChronosEventType.DREAM_FAILED:
      return 'ERROR';
    case ChronosEventType.TASK_MISSED:
      return 'WARN';
    default:
      return 'INFO';
  }
}

function formatEventMessage(event: ChronosEvent): string {
  const parts: string[] = [event.type];

  if (event.taskId) {
    parts.push(`task=${event.taskId}`);
  }
  if (event.cronExpression) {
    parts.push(`cron=${event.cronExpression}`);
  }
  if (event.message) {
    parts.push(event.message);
  }
  if (event.error) {
    parts.push(`error=${event.error}`);
  }

  return parts.join(' | ');
}

export function getRecentEvents(count: number = 10): ChronosEvent[] {
  return eventLog.slice(-count);
}

export function getAllEvents(): ChronosEvent[] {
  return [...eventLog];
}

export function clearEventLog(): void {
  eventLog.length = 0;
}

export function getEventsByType(type: ChronosEventType): ChronosEvent[] {
  return eventLog.filter((e) => e.type === type);
}

export function getEventsByTaskId(taskId: string): ChronosEvent[] {
  return eventLog.filter((e) => e.taskId === taskId);
}

export interface ChronosMetrics {
  totalTasks: number;
  activeTasks: number;
  failedTasks: number;
  missedTasks: number;
  totalExecutions: number;
  lastEventTime: number;
}

let taskMetrics = {
  totalTasks: 0,
  activeTasks: 0,
  failedTasks: 0,
  missedTasks: 0,
  totalExecutions: 0,
};

export function incrementTaskCreated(): void {
  taskMetrics.totalTasks++;
  taskMetrics.activeTasks++;
}

export function incrementTaskDeleted(): void {
  taskMetrics.activeTasks = Math.max(0, taskMetrics.activeTasks - 1);
}

export function incrementTaskExecuted(): void {
  taskMetrics.totalExecutions++;
}

export function incrementTaskFailed(): void {
  taskMetrics.failedTasks++;
}

export function incrementTaskMissed(): void {
  taskMetrics.missedTasks++;
}

export function getMetrics(): ChronosMetrics {
  return {
    ...taskMetrics,
    lastEventTime:
      eventLog.length > 0 ? (eventLog[eventLog.length - 1].timestamp ?? 0) : 0,
  };
}

export function resetMetrics(): void {
  taskMetrics = {
    totalTasks: 0,
    activeTasks: 0,
    failedTasks: 0,
    missedTasks: 0,
    totalExecutions: 0,
  };
}

export function logTaskCreated(taskId: string, cronExpression: string): void {
  logEvent({
    type: ChronosEventType.TASK_CREATED,
    taskId,
    cronExpression,
  });
  incrementTaskCreated();
}

export function logTaskDeleted(taskId: string): void {
  logEvent({
    type: ChronosEventType.TASK_DELETED,
    taskId,
  });
  incrementTaskDeleted();
}

export function logTaskExecuted(taskId: string, message?: string): void {
  logEvent({
    type: ChronosEventType.TASK_EXECUTED,
    taskId,
    message,
  });
  incrementTaskExecuted();
}

export function logTaskFailed(taskId: string, error: string): void {
  logEvent({
    type: ChronosEventType.TASK_FAILED,
    taskId,
    error,
  });
  incrementTaskFailed();
}

export function logTaskMissed(taskId: string): void {
  logEvent({
    type: ChronosEventType.TASK_MISSED,
    taskId,
  });
  incrementTaskMissed();
}

export function logDreamStarted(message?: string): void {
  logEvent({
    type: ChronosEventType.DREAM_STARTED,
    message,
  });
}

export function logDreamCompleted(message?: string): void {
  logEvent({
    type: ChronosEventType.DREAM_COMPLETED,
    message,
  });
}

export function logDreamFailed(error: string): void {
  logEvent({
    type: ChronosEventType.DREAM_FAILED,
    error,
  });
}

export function logHousekeepingStarted(): void {
  logEvent({
    type: ChronosEventType.HOUSEKEEPING_STARTED,
  });
}

export function logHousekeepingStopped(): void {
  logEvent({
    type: ChronosEventType.HOUSEKEEPING_STOPPED,
  });
}
