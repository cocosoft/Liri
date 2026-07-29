/**
 * CommandBridge — CG3 模块与全局命令队列的桥接层
 *
 * P1-9: 将 AlwaysOnRuntime/SelfWake 接入 MessageCommandQueue，
 * 实现 now/next/later 三级优先级的跨会话统一命令排队。
 *
 * 自身不导入 @modules/core 或 @modules/monitoring，
 * 通过延迟动态导入 MessageCommandQueue 避免循环依赖。
 */
import { cg3Log } from '../cg3Env';

export type QueuePriority = 'now' | 'next' | 'later';

export interface CG3Command {
  id: string;
  type: 'agent' | 'cron' | 'system';
  content: string;
  priority: QueuePriority;
  sessionId: string;
  metadata?: Record<string, unknown>;
}

export class CommandBridge {
  private pending = false;

  /** 入队一个 CG3 命令（去重 + 容量控制由 MessageCommandQueue 保证） */
  async enqueue(cmd: CG3Command): Promise<boolean> {
    try {
      const { getGlobalMessageQueue } = await import(
        '../../query/MessageCommandQueue'
      );
      const queue = getGlobalMessageQueue();
      return queue.enqueue({
        id: cmd.id,
        type: cmd.type,
        content: cmd.content,
        priority: cmd.priority,
        sessionId: cmd.sessionId,
        enqueuedAt: Date.now(),
        metadata: cmd.metadata,
      });
    } catch (err) {
      cg3Log(
        'tasks:commands:bridge',
        'error',
        'enqueueFailed',
        { error: String(err) }
      );
      return false;
    }
  }

  /** 批量入队 */
  async enqueueBatch(cmds: CG3Command[]): Promise<number> {
    let count = 0;
    for (const cmd of cmds) {
      if (await this.enqueue(cmd)) count++;
    }
    return count;
  }

  /** 获取待处理数量 */
  async pendingCount(): Promise<number> {
    try {
      const { getGlobalMessageQueue } = await import(
        '../../query/MessageCommandQueue'
      );
      return getGlobalMessageQueue().pendingCount;
    } catch {
      return 0;
    }
  }

  /** 按优先级统计 */
  async countByPriority(): Promise<Record<QueuePriority, number>> {
    try {
      const { getGlobalMessageQueue } = await import(
        '../../query/MessageCommandQueue'
      );
      return getGlobalMessageQueue().countByPriority();
    } catch {
      return { now: 0, next: 0, later: 0 };
    }
  }
}

/** 全局单例 */
let _cmdBridge: CommandBridge | null = null;

export function getCommandBridge(): CommandBridge {
  if (!_cmdBridge) _cmdBridge = new CommandBridge();
  return _cmdBridge;
}
