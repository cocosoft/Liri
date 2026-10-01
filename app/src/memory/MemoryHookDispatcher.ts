//
/**
 * Memory Hook 分发器
 * 在 Memory 关键生命周期点触发 Hook 事件
 * 支持 pre-save / post-save / pre-load / post-load 事件
 */

import type { Memory } from './types/Memory';
// 2026-10-01 D-168（`memory -> hooks` 倒挂收口）：Hook 分发改经 core SPI 取得，
// 端口返回最小投影 `{ blocked }`（原先直连 `@modules/hooks` 的 `HookChainManager`，
// 属 infra -> app 倒挂）。
import { resolveHookChain } from '@modules/core/spi';
import { getLogger } from '../monitoring/logs/Logger';
import { handleError } from '../error/handleError';

const logger = getLogger('memory:memoryHookDispatcher');

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
      const { blocked } = await resolveHookChain().execute('memory', {
        event: 'memory.pre-save',
        data: { memory, sessionId },
        sessionId,
      });

      if (blocked) {
        return { allowed: false };
      }

      return { allowed: true };
    } catch (error) {
      await handleError(error, { module: 'memory:hooks', action: 'pre_save' });
      return { allowed: true };
    }
  }

  /**
   * 执行 post-save Hook
   * 在记忆保存后触发，用于通知/日志/同步
   */
  async postSave(memory: Memory, sessionId?: string): Promise<void> {
    try {
      await resolveHookChain().execute('memory', {
        event: 'memory.post-save',
        data: { memory, sessionId },
        sessionId,
      });
    } catch (error) {
      await handleError(error, { module: 'memory:hooks', action: 'post_save' });
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
      const { blocked } = await resolveHookChain().execute('memory', {
        event: 'memory.pre-load',
        data: { memoryId, sessionId },
        sessionId,
      });

      if (blocked) {
        return { allowed: false };
      }

      return { allowed: true };
    } catch (error) {
      await handleError(error, { module: 'memory:hooks', action: 'pre_load' });
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
      await resolveHookChain().execute('memory', {
        event: 'memory.post-load',
        data: { memory, memoryId: memory.id, sessionId },
        sessionId,
      });
    } catch (error) {
      await handleError(error, { module: 'memory:hooks', action: 'post_load' });
    }
  }
}
