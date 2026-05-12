/**
 * 聊天会话元数据管理服务
 * 实现会话元数据的存储和变更通知
 */

import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import type { PermissionMode } from '../permission/PermissionMode';
import type { RequiresActionDetails } from './ChatSessionStateManager.js';

const logger = new Logger({ level: LogLevel.INFO });

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
}

/**
 * 会话元数据变更监听器
 */
type SessionMetadataChangedListener = (
  metadata: Partial<SessionExternalMetadata>
) => void;

/**
 * 权限模式变更监听器
 */
type PermissionModeChangedListener = (mode: PermissionMode) => void;

/**
 * 会话元数据管理服务
 */
export class ChatSessionMetadataManager {
  private static instance: ChatSessionMetadataManager;
  private metadata: SessionExternalMetadata;
  private metadataListeners: Set<SessionMetadataChangedListener> = new Set();
  private permissionModeListeners: Set<PermissionModeChangedListener> =
    new Set();

  private constructor() {
    this.metadata = this.getDefaultMetadata();
  }

  /**
   * 获取默认元数据
   */
  private getDefaultMetadata(): SessionExternalMetadata {
    return {
      permission_mode: null,
      is_ultraplan_mode: null,
      model: null,
      pending_action: null,
      post_turn_summary: null,
      task_summary: null,
    };
  }

  /**
   * 获取单例实例
   */
  static getInstance(): ChatSessionMetadataManager {
    if (!ChatSessionMetadataManager.instance) {
      ChatSessionMetadataManager.instance = new ChatSessionMetadataManager();
    }
    return ChatSessionMetadataManager.instance;
  }

  /**
   * 获取当前元数据
   */
  getMetadata(): SessionExternalMetadata {
    return { ...this.metadata };
  }

  /**
   * 获取特定元数据字段
   */
  getMetadataField<K extends keyof SessionExternalMetadata>(
    key: K
  ): SessionExternalMetadata[K] {
    return this.metadata[key];
  }

  /**
   * 更新元数据
   */
  updateMetadata(updates: Partial<SessionExternalMetadata>): void {
    this.metadata = {
      ...this.metadata,
      ...updates,
    };

    // 通知所有监听器
    this.metadataListeners.forEach((listener) => {
      try {
        listener(updates);
      } catch (error) {
        logger.error('[chat] Error in metadata listener:', error);
      }
    });
  }

  /**
   * 通知元数据变更
   */
  notifyMetadataChanged(metadata: Partial<SessionExternalMetadata>): void {
    this.updateMetadata(metadata);
  }

  /**
   * 设置权限模式
   */
  setPermissionMode(mode: PermissionMode): void {
    this.metadata.permission_mode = mode;

    this.metadataListeners.forEach((listener) => {
      try {
        listener({ permission_mode: mode });
      } catch (error) {
        logger.error('[chat] Error in metadata listener:', error);
      }
    });

    // 通知权限模式变更监听器
    this.permissionModeListeners.forEach((listener) => {
      try {
        listener(mode);
      } catch (error) {
        logger.error('[chat] Error in permission mode listener:', error);
      }
    });
  }

  /**
   * 获取权限模式
   */
  getPermissionMode(): PermissionMode | null {
    return this.metadata.permission_mode ?? null;
  }

  /**
   * 设置待处理动作
   */
  setPendingAction(action: RequiresActionDetails | null): void {
    this.metadata.pending_action = action;
    this.notifyMetadataChanged({ pending_action: action });
  }

  /**
   * 获取待处理动作
   */
  getPendingAction(): RequiresActionDetails | null {
    return this.metadata.pending_action ?? null;
  }

  /**
   * 设置任务摘要
   */
  setTaskSummary(summary: string | null): void {
    this.metadata.task_summary = summary;
    this.notifyMetadataChanged({ task_summary: summary });
  }

  /**
   * 获取任务摘要
   */
  getTaskSummary(): string | null {
    return this.metadata.task_summary ?? null;
  }

  /**
   * 设置模型
   */
  setModel(model: string | null): void {
    this.metadata.model = model;
    this.notifyMetadataChanged({ model });
  }

  /**
   * 获取模型
   */
  getModel(): string | null {
    return this.metadata.model ?? null;
  }

  /**
   * 设置UltraPlan模式
   */
  setUltraPlanMode(isUltraPlan: boolean): void {
    this.metadata.is_ultraplan_mode = isUltraPlan;
    this.notifyMetadataChanged({ is_ultraplan_mode: isUltraPlan });
  }

  /**
   * 获取UltraPlan模式
   */
  isUltraPlanMode(): boolean {
    return this.metadata.is_ultraplan_mode ?? false;
  }

  /**
   * 添加元数据变更监听器
   */
  addMetadataListener(listener: SessionMetadataChangedListener): () => void {
    this.metadataListeners.add(listener);
    return () => {
      this.metadataListeners.delete(listener);
    };
  }

  /**
   * 移除元数据变更监听器
   */
  removeMetadataListener(listener: SessionMetadataChangedListener): void {
    this.metadataListeners.delete(listener);
  }

  /**
   * 添加权限模式变更监听器
   */
  addPermissionModeListener(
    listener: PermissionModeChangedListener
  ): () => void {
    this.permissionModeListeners.add(listener);
    return () => {
      this.permissionModeListeners.delete(listener);
    };
  }

  /**
   * 移除权限模式变更监听器
   */
  removePermissionModeListener(listener: PermissionModeChangedListener): void {
    this.permissionModeListeners.delete(listener);
  }

  /**
   * 清空所有监听器
   */
  clearListeners(): void {
    this.metadataListeners.clear();
    this.permissionModeListeners.clear();
  }

  /**
   * 重置元数据
   */
  reset(): void {
    this.metadata = this.getDefaultMetadata();
    this.notifyMetadataChanged(this.metadata);
  }
}

/**
 * 获取会话元数据管理器实例
 */
export function getChatSessionMetadataManager(): ChatSessionMetadataManager {
  return ChatSessionMetadataManager.getInstance();
}

/**
 * 获取当前会话元数据（便捷函数）
 */
export function getSessionMetadata(): SessionExternalMetadata {
  const manager = getChatSessionMetadataManager();
  return manager.getMetadata();
}

/**
 * 通知会话元数据变更（便捷函数）
 */
export function notifySessionMetadataChanged(
  metadata: Partial<SessionExternalMetadata>
): void {
  const manager = getChatSessionMetadataManager();
  manager.notifyMetadataChanged(metadata);
}
