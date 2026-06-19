/**
 * CommandStateManager 命令状态管理器
 * 管理命令的执行状态、运行时上下文和持久化
 */
import type { CommandResult } from '@modules/commands';

/**
 * 命令执行阶段
 */
export enum CommandPhase {
  PENDING = 'pending',
  VALIDATING = 'validating',
  EXECUTING = 'executing',
  COMPLETED = 'completed',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
}

/**
 * 命令执行快照
 */
export interface CommandSnapshot {
  id: string;
  command: string;
  args: string;
  phase: CommandPhase;
  startedAt: number;
  completedAt?: number;
  duration?: number;
  result?: CommandResult;
  error?: string;
  metadata: Record<string, unknown>;
}

/**
 * 命令状态监听器
 */
export type CommandStateListener = (snapshot: CommandSnapshot) => void;

/**
 * 命令状态管理器
 * 跟踪每个命令的执行生命周期，支持状态查询和事件监听
 */
export class CommandStateManager {
  private snapshots: Map<string, CommandSnapshot> = new Map();
  private listeners: Set<CommandStateListener> = new Set();
  private maxHistory: number = 1000;
  private counter: number = 0;

  /**
   * 创建命令执行快照
   */
  createSnapshot(
    command: string,
    args: string,
    metadata?: Record<string, unknown>
  ): string {
    const id = `cmd_${Date.now()}_${++this.counter}`;
    const snapshot: CommandSnapshot = {
      id,
      command,
      args,
      phase: CommandPhase.PENDING,
      startedAt: Date.now(),
      metadata: metadata || {},
    };

    this.snapshots.set(id, snapshot);
    this.notifyListeners(snapshot);
    this.enforceHistoryLimit();

    return id;
  }

  /**
   * 更新命令阶段
   */
  updatePhase(id: string, phase: CommandPhase, error?: string): void {
    const snapshot = this.snapshots.get(id);
    if (!snapshot) return;

    snapshot.phase = phase;

    if (
      phase === CommandPhase.COMPLETED ||
      phase === CommandPhase.FAILED ||
      phase === CommandPhase.CANCELLED
    ) {
      snapshot.completedAt = Date.now();
      snapshot.duration = snapshot.completedAt - snapshot.startedAt;
    }

    if (error) {
      snapshot.error = error;
    }

    this.notifyListeners(snapshot);
  }

  /**
   * 设置执行结果
   */
  setResult(id: string, result: CommandResult): void {
    const snapshot = this.snapshots.get(id);
    if (!snapshot) return;

    snapshot.result = result;
    snapshot.phase = result.success
      ? CommandPhase.COMPLETED
      : CommandPhase.FAILED;
    snapshot.completedAt = Date.now();
    snapshot.duration = snapshot.completedAt - snapshot.startedAt;

    this.notifyListeners(snapshot);
  }

  /**
   * 获取快照
   */
  getSnapshot(id: string): CommandSnapshot | undefined {
    return this.snapshots.get(id);
  }

  /**
   * 获取所有活跃（未完成）的命令
   */
  getActiveCommands(): CommandSnapshot[] {
    return Array.from(this.snapshots.values())
      .filter(
        (s) =>
          s.phase === CommandPhase.PENDING ||
          s.phase === CommandPhase.VALIDATING ||
          s.phase === CommandPhase.EXECUTING
      )
      .sort((a, b) => b.startedAt - a.startedAt);
  }

  /**
   * 获取命令执行历史
   */
  getHistory(limit: number = 50): CommandSnapshot[] {
    return Array.from(this.snapshots.values())
      .sort((a, b) => b.startedAt - a.startedAt)
      .slice(0, limit);
  }

  /**
   * 获取特定命令的执行记录
   */
  getCommandHistory(name: string, limit: number = 20): CommandSnapshot[] {
    return Array.from(this.snapshots.values())
      .filter((s) => s.command === name)
      .sort((a, b) => b.startedAt - a.startedAt)
      .slice(0, limit);
  }

  /**
   * 获取最后的命令结果
   */
  getLastResult(command: string): CommandResult | undefined {
    const history = this.getCommandHistory(command, 1);
    return history[0]?.result;
  }

  /**
   * 注册状态监听器
   */
  addListener(listener: CommandStateListener): void {
    this.listeners.add(listener);
  }

  /**
   * 移除状态监听器
   */
  removeListener(listener: CommandStateListener): void {
    this.listeners.delete(listener);
  }

  /**
   * 通知所有监听器
   */
  private notifyListeners(snapshot: CommandSnapshot): void {
    for (const listener of this.listeners) {
      try {
        listener(snapshot);
      } catch {
        // 忽略监听器错误
      }
    }
  }

  /**
   * 强制历史记录上限
   */
  private enforceHistoryLimit(): void {
    if (this.snapshots.size <= this.maxHistory) return;

    const entries = Array.from(this.snapshots.entries()).sort(
      ([, a], [, b]) => a.startedAt - b.startedAt
    );

    const toDelete = entries.slice(0, entries.length - this.maxHistory);
    for (const [id] of toDelete) {
      this.snapshots.delete(id);
    }
  }

  /**
   * 清除历史
   */
  clearHistory(): void {
    this.snapshots.clear();
  }

  /**
   * 获取统计摘要
   */
  getStats(): {
    total: number;
    active: number;
    completed: number;
    failed: number;
    cancelled: number;
  } {
    const all = Array.from(this.snapshots.values());
    return {
      total: all.length,
      active: all.filter(
        (s) =>
          s.phase === CommandPhase.PENDING ||
          s.phase === CommandPhase.VALIDATING ||
          s.phase === CommandPhase.EXECUTING
      ).length,
      completed: all.filter((s) => s.phase === CommandPhase.COMPLETED).length,
      failed: all.filter((s) => s.phase === CommandPhase.FAILED).length,
      cancelled: all.filter((s) => s.phase === CommandPhase.CANCELLED).length,
    };
  }
}

export const commandStateManager = new CommandStateManager();
