/**
 * 事件通知服务
 * 提供统一的事件通知和管理功能
 * 参考CC源码: cc_code/backend/utils/sessionState.ts
 */

import { EventEmitter } from 'events';
import { SessionState } from '../../state/session/types.js';
import type { RequiresActionDetails } from '../../state/session/types.js';
import type {
  PermissionMode,
  SessionExternalMetadata,
} from './SessionMetadataService.js';

/**
 * 事件类型
 */
export enum EventType {
  SESSION_STATE_CHANGED = 'session_state_changed',
  METADATA_CHANGED = 'metadata_changed',
  PERMISSION_MODE_CHANGED = 'permission_mode_changed',
  MODEL_CHANGED = 'model_changed',
  PENDING_ACTION_CHANGED = 'pending_action_changed',
  TASK_SUMMARY_CHANGED = 'task_summary_changed',
}

/**
 * 事件数据
 */
export interface EventData {
  type: EventType;
  timestamp: number;
  data: unknown;
}

/**
 * 事件监听器
 */
export type EventListener = (event: EventData) => void;

/**
 * 事件通知服务类
 */
export class EventNotificationService extends EventEmitter {
  private static instance: EventNotificationService;
  private eventHistory: EventData[] = [];
  private maxHistorySize: number = 200;
  private enabled: boolean = true;

  private constructor() {
    super();
  }

  /**
   * 获取单例实例
   */
  static getInstance(): EventNotificationService {
    if (!EventNotificationService.instance) {
      EventNotificationService.instance = new EventNotificationService();
    }
    return EventNotificationService.instance;
  }

  /**
   * 启用事件通知
   */
  enable(): void {
    this.enabled = true;
  }

  /**
   * 禁用事件通知
   */
  disable(): void {
    this.enabled = false;
  }

  /**
   * 检查是否启用
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * 发送会话状态变化事件
   */
  emitSessionStateChanged(
    state: SessionState,
    details?: RequiresActionDetails
  ): void {
    if (!this.enabled) return;

    const event: EventData = {
      type: EventType.SESSION_STATE_CHANGED,
      timestamp: Date.now(),
      data: { state, details },
    };

    this.emitEvent(event);
  }

  /**
   * 发送元数据变化事件
   */
  emitMetadataChanged(metadata: Partial<SessionExternalMetadata>): void {
    if (!this.enabled) return;

    const event: EventData = {
      type: EventType.METADATA_CHANGED,
      timestamp: Date.now(),
      data: metadata,
    };

    this.emitEvent(event);
  }

  /**
   * 发送权限模式变化事件
   */
  emitPermissionModeChanged(mode: PermissionMode): void {
    if (!this.enabled) return;

    const event: EventData = {
      type: EventType.PERMISSION_MODE_CHANGED,
      timestamp: Date.now(),
      data: { mode },
    };

    this.emitEvent(event);
  }

  /**
   * 发送模型变化事件
   */
  emitModelChanged(model: string): void {
    if (!this.enabled) return;

    const event: EventData = {
      type: EventType.MODEL_CHANGED,
      timestamp: Date.now(),
      data: { model },
    };

    this.emitEvent(event);
  }

  /**
   * 发送待处理操作变化事件
   */
  emitPendingActionChanged(action: RequiresActionDetails | null): void {
    if (!this.enabled) return;

    const event: EventData = {
      type: EventType.PENDING_ACTION_CHANGED,
      timestamp: Date.now(),
      data: { action },
    };

    this.emitEvent(event);
  }

  /**
   * 发送任务摘要变化事件
   */
  emitTaskSummaryChanged(summary: string | null): void {
    if (!this.enabled) return;

    const event: EventData = {
      type: EventType.TASK_SUMMARY_CHANGED,
      timestamp: Date.now(),
      data: { summary },
    };

    this.emitEvent(event);
  }

  /**
   * 发送自定义事件
   */
  emitCustomEvent(type: string, data: unknown): void {
    if (!this.enabled) return;

    const event: EventData = {
      type: type as EventType,
      timestamp: Date.now(),
      data,
    };

    this.emitEvent(event);
  }

  /**
   * 发送事件
   */
  private emitEvent(event: EventData): void {
    this.addToHistory(event);
    this.emit('event', event);
    this.emit(event.type, event);
  }

  /**
   * 订阅所有事件
   */
  subscribeToAll(listener: EventListener): void {
    this.on('event', listener);
  }

  /**
   * 取消订阅所有事件
   */
  unsubscribeFromAll(listener: EventListener): void {
    this.off('event', listener);
  }

  /**
   * 订阅特定类型事件
   */
  subscribeToType(type: EventType, listener: EventListener): void {
    this.on(type, listener);
  }

  /**
   * 取消订阅特定类型事件
   */
  unsubscribeFromType(type: EventType, listener: EventListener): void {
    this.off(type, listener);
  }

  /**
   * 获取事件历史
   */
  getEventHistory(): EventData[] {
    return [...this.eventHistory];
  }

  /**
   * 获取特定类型的事件历史
   */
  getEventHistoryByType(type: EventType): EventData[] {
    return this.eventHistory.filter((e) => e.type === type);
  }

  /**
   * 清除事件历史
   */
  clearEventHistory(): void {
    this.eventHistory = [];
  }

  /**
   * 获取最近的事件
   */
  getLastEvent(): EventData | null {
    return this.eventHistory.length > 0
      ? this.eventHistory[this.eventHistory.length - 1]
      : null;
  }

  /**
   * 获取事件统计
   */
  getEventStats(): Record<string, number> {
    const stats: Record<string, number> = {};
    for (const event of this.eventHistory) {
      const type = event.type as string;
      stats[type] = (stats[type] || 0) + 1;
    }
    return stats;
  }

  /**
   * 添加到历史记录
   */
  private addToHistory(event: EventData): void {
    this.eventHistory.push(event);
    if (this.eventHistory.length > this.maxHistorySize) {
      this.eventHistory.shift();
    }
  }

  /**
   * 重置服务
   */
  reset(): void {
    this.eventHistory = [];
    this.enabled = true;
    this.removeAllListeners();
  }
}

/**
 * 导出单例
 */
export const eventNotificationService = EventNotificationService.getInstance();
