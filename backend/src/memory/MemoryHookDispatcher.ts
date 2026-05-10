//
/**
 * Memory Hook 分发器
 * 在 Memory 关键生命周期点触发 Hook 事件
 * 支持 pre-save / post-save / pre-load / post-load 事件
 */

import type { Memory } from './types/Memory';
import { HookManager } from '../hooks/managers/HookManager';
import { Logger, LogLevel } from '../monitoring/logs/Logger';

const logger = new Logger({ level: LogLevel.INFO });

/**
 * Memory Hook 事件类型
 */
export type MemoryHookEvent =
  | 'memory.pre-save'
  | 'memory.post-save'
  | 'memory.pre-load'
  | 'memory.post-load';

/**
 * Memory Hook 数据
 */
export interface MemoryHookData {
  memory?: Memory;
  memoryId?: string;
  updates?: Partial<Memory>;
  sessionId?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Memory Hook 分发器
 * 包装 MemoryManager 的关键方法，在前后触发 Hook 事件
 */
export class MemoryHookDispatcher {
  private hookManager: HookManager;

  constructor() {
    this.hookManager = HookManager.getInstance();
  }

  /**
   * 执行 pre-save Hook
   * 在记忆保存前触发，允许 Hook 修改或阻止保存
   */
  async preSave(
    memory: Omit<Memory, 'id' | 'createdAt' | 'updatedAt'>,
    sessionId?: string
  ): Promise<{
    allowed: boolean;
    modifiedMemory?: Omit<Memory, 'id' | 'createdAt' | 'updatedAt'>;
  }> {
    try {
      const results = await this.hookManager.executeHooks(
        'memory.pre-save' as any,
        { memory, sessionId } as MemoryHookData,
        [],
        sessionId
      );

      for (const result of results) {
        if (!result.success || result.preventContinuation) {
          return { allowed: false };
        }
      }

      return { allowed: true };
    } catch (error) {
      logger.error(
        `Memory pre-save hook failed: ${error instanceof Error ? error.message : String(error)}`
      );
      return { allowed: true };
    }
  }

  /**
   * 执行 post-save Hook
   * 在记忆保存后触发，用于通知/日志/同步
   */
  async postSave(memory: Memory, sessionId?: string): Promise<void> {
    try {
      await this.hookManager.executeHooks(
        'memory.post-save' as any,
        { memory, sessionId } as MemoryHookData,
        [],
        sessionId
      );
    } catch (error) {
      logger.error(
        `Memory post-save hook failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * 执行 pre-load Hook
   * 在记忆加载前触发，用于权限检查或数据预处理
   */
  async preLoad(
    memoryId: string,
    sessionId?: string
  ): Promise<{ allowed: boolean }> {
    try {
      const results = await this.hookManager.executeHooks(
        'memory.pre-load' as any,
        { memoryId, sessionId } as MemoryHookData,
        [],
        sessionId
      );

      for (const result of results) {
        if (!result.success || result.preventContinuation) {
          return { allowed: false };
        }
      }

      return { allowed: true };
    } catch (error) {
      logger.error(
        `Memory pre-load hook failed: ${error instanceof Error ? error.message : String(error)}`
      );
      return { allowed: true };
    }
  }

  /**
   * 执行 post-load Hook
   * 在记忆加载后触发，用于审计或缓存更新
   */
  async postLoad(memory: Memory | null, sessionId?: string): Promise<void> {
    if (!memory) return;

    try {
      await this.hookManager.executeHooks(
        'memory.post-load' as any,
        { memory, memoryId: memory.id, sessionId } as MemoryHookData,
        [],
        sessionId
      );
    } catch (error) {
      logger.error(
        `Memory post-load hook failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
}
