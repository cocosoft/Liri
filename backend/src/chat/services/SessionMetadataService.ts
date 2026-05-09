/**
 * 会话元数据服务
 * 提供会话元数据管理和事件通知功能
 * 参考CC源码: cc_code/backend/utils/sessionState.ts
 */

import { EventEmitter } from 'events';
import type { RequiresActionDetails } from './SessionStateService.js';
import { performanceOptimizationService } from './PerformanceOptimizationService.js';

/**
 * 权限模式类型
 */
export type PermissionMode = 'default' | 'plan' | 'auto' | 'yolo';

/**
 * 会话外部元数据
 */
export interface SessionExternalMetadata {
  permission_mode?: PermissionMode | null;
  is_ultraplan_mode?: boolean | null;
  model?: string | null;
  pending_action?: RequiresActionDetails | null;
  post_turn_summary?: unknown;
  task_summary?: string | null;
  [key: string]: unknown;
}

/**
 * 元数据变化事件
 */
export interface MetadataChangedEvent {
  metadata: SessionExternalMetadata;
  changes: Partial<SessionExternalMetadata>;
  timestamp: number;
}

/**
 * 元数据监听器
 */
export type MetadataListener = (metadata: SessionExternalMetadata) => void;

/**
 * 权限模式监听器
 */
export type PermissionModeListener = (mode: PermissionMode) => void;

/**
 * 会话元数据服务类
 */
export class SessionMetadataService extends EventEmitter {
  private static instance: SessionMetadataService;
  private metadata: SessionExternalMetadata = {};
  private metadataHistory: MetadataChangedEvent[] = [];
  private maxHistorySize: number = 100;

  private constructor() {
    super();
  }

  /**
   * 获取单例实例
   */
  static getInstance(): SessionMetadataService {
    if (!SessionMetadataService.instance) {
      SessionMetadataService.instance = new SessionMetadataService();
    }
    return SessionMetadataService.instance;
  }

  /**
   * 获取当前元数据
   */
  getMetadata(): SessionExternalMetadata {
    const cacheKey = 'session_metadata_current';
    const cachedMetadata =
      performanceOptimizationService.get<SessionExternalMetadata>(cacheKey);
    if (cachedMetadata !== null) {
      return cachedMetadata;
    }

    const metadata = { ...this.metadata };
    performanceOptimizationService.set(cacheKey, metadata, 60000);
    return metadata;
  }

  /**
   * 通知元数据变化
   */
  notifyMetadataChanged(metadata: Partial<SessionExternalMetadata>): void {
    const changes = { ...metadata };
    this.metadata = { ...this.metadata, ...metadata };

    const event: MetadataChangedEvent = {
      metadata: this.getMetadata(),
      changes,
      timestamp: Date.now(),
    };

    this.addToHistory(event);

    this.emit('metadataChanged', this.metadata);
    this.emit('metadataChangedWithEvent', event);

    if (metadata.permission_mode !== undefined) {
      this.emit('permissionModeChanged', metadata.permission_mode);
    }

    if (metadata.model !== undefined) {
      this.emit('modelChanged', metadata.model);
    }

    if (metadata.pending_action !== undefined) {
      this.emit('pendingActionChanged', metadata.pending_action);
    }

    if (metadata.task_summary !== undefined) {
      this.emit('taskSummaryChanged', metadata.task_summary);
    }
  }

  /**
   * 设置权限模式
   */
  setPermissionMode(mode: PermissionMode): void {
    this.notifyMetadataChanged({ permission_mode: mode });
  }

  /**
   * 获取权限模式
   */
  getPermissionMode(): PermissionMode | null {
    return this.metadata.permission_mode || null;
  }

  /**
   * 设置模型
   */
  setModel(model: string): void {
    this.notifyMetadataChanged({ model });
  }

  /**
   * 获取模型
   */
  getModel(): string | null {
    return this.metadata.model || null;
  }

  /**
   * 设置待处理操作
   */
  setPendingAction(action: RequiresActionDetails | null): void {
    this.notifyMetadataChanged({ pending_action: action });
  }

  /**
   * 获取待处理操作
   */
  getPendingAction(): RequiresActionDetails | null {
    return this.metadata.pending_action || null;
  }

  /**
   * 设置任务摘要
   */
  setTaskSummary(summary: string | null): void {
    this.notifyMetadataChanged({ task_summary: summary });
  }

  /**
   * 获取任务摘要
   */
  getTaskSummary(): string | null {
    return this.metadata.task_summary || null;
  }

  /**
   * 设置元数据监听器
   */
  setMetadataListener(listener: MetadataListener): void {
    this.on('metadataChanged', listener);
  }

  /**
   * 移除元数据监听器
   */
  removeMetadataListener(listener: MetadataListener): void {
    this.off('metadataChanged', listener);
  }

  /**
   * 设置权限模式监听器
   */
  setPermissionModeListener(listener: PermissionModeListener): void {
    this.on('permissionModeChanged', listener);
  }

  /**
   * 移除权限模式监听器
   */
  removePermissionModeListener(listener: PermissionModeListener): void {
    this.off('permissionModeChanged', listener);
  }

  /**
   * 获取元数据历史
   */
  getMetadataHistory(): MetadataChangedEvent[] {
    return [...this.metadataHistory];
  }

  /**
   * 清除元数据历史
   */
  clearMetadataHistory(): void {
    this.metadataHistory = [];
  }

  /**
   * 获取最近的元数据变化
   */
  getLastMetadataChange(): MetadataChangedEvent | null {
    return this.metadataHistory.length > 0
      ? this.metadataHistory[this.metadataHistory.length - 1]
      : null;
  }

  /**
   * 清除特定字段
   */
  clearField(field: keyof SessionExternalMetadata): void {
    this.notifyMetadataChanged({ [field]: null });
  }

  /**
   * 清除所有元数据
   */
  clearAll(): void {
    this.metadata = {};
    this.emit('metadataCleared');
  }

  /**
   * 添加到历史记录
   */
  private addToHistory(event: MetadataChangedEvent): void {
    this.metadataHistory.push(event);
    if (this.metadataHistory.length > this.maxHistorySize) {
      this.metadataHistory.shift();
    }
  }

  /**
   * 重置服务
   */
  reset(): void {
    this.metadata = {};
    this.metadataHistory = [];
    this.removeAllListeners();
  }
}

/**
 * 导出单例
 */
export const sessionMetadataService = SessionMetadataService.getInstance();
