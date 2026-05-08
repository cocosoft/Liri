//
/**
 * 权限模式集成服务
 * 集成权限系统与会话元数据服务
 */

import { EventEmitter } from 'events';
import type { PermissionMode } from '@modules/permission/PermissionMode.js';
import {
  sessionMetadataService,
  type PermissionModeListener,
} from './SessionMetadataService.js';
import { eventNotificationService } from './EventNotificationService.js';

/**
 * 权限模式变化事件
 */
export interface PermissionModeChangedEvent {
  previousMode: PermissionMode | null;
  currentMode: PermissionMode;
  timestamp: number;
}

/**
 * 权限模式集成服务类
 */
export class PermissionModeIntegrationService extends EventEmitter {
  private static instance: PermissionModeIntegrationService;
  private currentMode: PermissionMode | null = null;
  private modeHistory: PermissionModeChangedEvent[] = [];
  private maxHistorySize: number = 50;

  private constructor() {
    super();
    this.initialize();
  }

  /**
   * 获取单例实例
   */
  static getInstance(): PermissionModeIntegrationService {
    if (!PermissionModeIntegrationService.instance) {
      PermissionModeIntegrationService.instance =
        new PermissionModeIntegrationService();
    }
    return PermissionModeIntegrationService.instance;
  }

  /**
   * 初始化服务
   */
  private initialize(): void {
    const currentMode = sessionMetadataService.getPermissionMode();
    if (currentMode) {
      this.currentMode = currentMode;
    }

    sessionMetadataService.setPermissionModeListener((mode) => {
      this.handlePermissionModeChanged(mode);
    });
  }

  /**
   * 处理权限模式变化
   */
  private handlePermissionModeChanged(mode: PermissionMode): void {
    const previousMode = this.currentMode;
    this.currentMode = mode;

    const event: PermissionModeChangedEvent = {
      previousMode,
      currentMode: mode,
      timestamp: Date.now(),
    };

    this.addToHistory(event);

    this.emit('permissionModeChanged', event);
    this.emit('modeChanged', mode);

    eventNotificationService.emitPermissionModeChanged(mode);
  }

  /**
   * 设置权限模式
   */
  setPermissionMode(mode: PermissionMode): void {
    sessionMetadataService.setPermissionMode(mode);
  }

  /**
   * 获取当前权限模式
   */
  getPermissionMode(): PermissionMode | null {
    return this.currentMode;
  }

  /**
   * 重置权限模式
   */
  resetPermissionMode(): void {
    sessionMetadataService.setPermissionMode('default');
  }

  /**
   * 检查是否为自动模式
   */
  isAutoMode(): boolean {
    return this.currentMode === 'auto' || this.currentMode === 'acceptEdits';
  }

  /**
   * 检查是否为计划模式
   */
  isPlanMode(): boolean {
    return this.currentMode === 'plan';
  }

  /**
   * 检查是否为默认模式
   */
  isDefaultMode(): boolean {
    return this.currentMode === 'default';
  }

  /**
   * 检查是否为不询问模式
   */
  isDontAskMode(): boolean {
    return this.currentMode === 'dontAsk';
  }

  /**
   * 检查是否应该避免权限提示
   */
  shouldAvoidPermissionPrompts(): boolean {
    return this.currentMode === 'dontAsk';
  }

  /**
   * 设置权限模式监听器
   */
  setPermissionModeListener(listener: (mode: PermissionMode) => void): void {
    this.on('modeChanged', listener);
  }

  /**
   * 移除权限模式监听器
   */
  removePermissionModeListener(
    listener: (mode: PermissionMode) => void
  ): void {
    this.off('modeChanged', listener);
  }

  /**
   * 获取权限模式历史
   */
  getModeHistory(): PermissionModeChangedEvent[] {
    return [...this.modeHistory];
  }

  /**
   * 清除权限模式历史
   */
  clearModeHistory(): void {
    this.modeHistory = [];
  }

  /**
   * 获取最近的权限模式变化
   */
  getLastModeChange(): PermissionModeChangedEvent | null {
    return this.modeHistory.length > 0
      ? this.modeHistory[this.modeHistory.length - 1]
      : null;
  }

  /**
   * 获取权限模式统计
   */
  getModeStats(): Record<PermissionMode, number> {
    const stats: Record<string, number> = {
      default: 0,
      auto: 0,
      acceptEdits: 0,
      dontAsk: 0,
      plan: 0,
    };

    for (const event of this.modeHistory) {
      const mode = event.currentMode;
      stats[mode] = (stats[mode] || 0) + 1;
    }

    return stats as Record<PermissionMode, number>;
  }

  /**
   * 添加到历史记录
   */
  private addToHistory(event: PermissionModeChangedEvent): void {
    this.modeHistory.push(event);
    if (this.modeHistory.length > this.maxHistorySize) {
      this.modeHistory.shift();
    }
  }

  /**
   * 重置服务
   */
  reset(): void {
    this.currentMode = null;
    this.modeHistory = [];
    this.removeAllListeners();
  }
}

/**
 * 导出单例
 */
export const permissionModeIntegrationService =
  PermissionModeIntegrationService.getInstance();
