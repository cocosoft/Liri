/**
 * TurnManager 通道轮转管理器
 * 对标 OpenClaw channels/turn/，管理消息轮转和发送队列
 */
import { EventEmitter } from 'node:events';

/**
 * 轮转策略
 */
export type TurnStrategy = 'round-robin' | 'priority' | 'sequential' | 'random';

/**
 * 轮转条目
 */
export interface TurnEntry {
  id: string;
  name: string;
  priority: number;
  lastTurn: number;
  turnCount: number;
  cooldownUntil: number;
}

/**
 * 轮转配置
 */
export interface TurnConfig {
  strategy: TurnStrategy;
  cooldownMs: number;
  maxConsecutive: number;
}

/**
 * 轮转事件
 */
export interface TurnEvent {
  entryId: string;
  type: 'assigned' | 'skipped' | 'cooldown' | 'completed';
  timestamp: number;
}

/**
 * 通道轮转管理器
 */
export class TurnManager extends EventEmitter {
  private entries: Map<string, TurnEntry> = new Map();
  private config: TurnConfig;
  private lastAssignedIndex: number = -1;
  private consecutiveCount: number = 0;
  private lastAssignedId: string = '';

  constructor(config?: Partial<TurnConfig>) {
    super();

    this.config = {
      strategy: 'round-robin',
      cooldownMs: 1000,
      maxConsecutive: 3,
      ...config,
    };
  }

  /**
   * 注册轮转条目
   */
  register(id: string, name: string, priority: number = 100): boolean {
    if (this.entries.has(id)) {
      return false;
    }

    this.entries.set(id, {
      id,
      name,
      priority,
      lastTurn: 0,
      turnCount: 0,
      cooldownUntil: 0,
    });

    return true;
  }

  /**
   * 注销轮转条目
   */
  unregister(id: string): boolean {
    return this.entries.delete(id);
  }

  /**
   * 获取下一个轮转目标
   */
  next(): TurnEntry | undefined {
    const available = this.getAvailable();

    if (available.length === 0) {
      return undefined;
    }

    const entry = this.selectByStrategy(available);

    if (entry) {
      entry.lastTurn = Date.now();
      entry.turnCount++;
      entry.cooldownUntil = Date.now() + this.config.cooldownMs;
      this.lastAssignedId = entry.id;

      if (this.lastAssignedId === entry.id) {
        this.consecutiveCount++;
      } else {
        this.consecutiveCount = 1;
      }

      this.lastAssignedIndex = this.getEntryIndex(entry.id);

      const event: TurnEvent = {
        entryId: entry.id,
        type: 'assigned',
        timestamp: Date.now(),
      };

      this.emit('turn:assigned', event);
    }

    return entry;
  }

  /**
   * 获取可用条目
   */
  private getAvailable(): TurnEntry[] {
    const now = Date.now();
    const available: TurnEntry[] = [];

    for (const entry of this.entries.values()) {
      if (entry.cooldownUntil > now) {
        const event: TurnEvent = {
          entryId: entry.id,
          type: 'cooldown',
          timestamp: now,
        };

        this.emit('turn:cooldown', event);

        continue;
      }

      if (
        entry.id === this.lastAssignedId &&
        this.consecutiveCount >= this.config.maxConsecutive
      ) {
        const event: TurnEvent = {
          entryId: entry.id,
          type: 'skipped',
          timestamp: now,
        };

        this.emit('turn:skipped', event);

        continue;
      }

      available.push(entry);
    }

    return available;
  }

  /**
   * 按策略选择
   */
  private selectByStrategy(available: TurnEntry[]): TurnEntry | undefined {
    switch (this.config.strategy) {
      case 'round-robin':
        return this.selectRoundRobin(available);

      case 'priority':
        return this.selectPriority(available);

      case 'sequential':
        return this.selectSequential(available);

      case 'random':
        return this.selectRandom(available);

      default:
        return available[0];
    }
  }

  /**
   * 轮询策略
   */
  private selectRoundRobin(available: TurnEntry[]): TurnEntry | undefined {
    if (available.length === 0) {
      return undefined;
    }

    const nextIndex = (this.lastAssignedIndex + 1) % available.length;

    return available[nextIndex];
  }

  /**
   * 优先级策略
   */
  private selectPriority(available: TurnEntry[]): TurnEntry | undefined {
    available.sort((a, b) => b.priority - a.priority);

    return available[0];
  }

  /**
   * 顺序策略
   */
  private selectSequential(available: TurnEntry[]): TurnEntry | undefined {
    available.sort((a, b) => a.lastTurn - b.lastTurn);

    return available[0];
  }

  /**
   * 随机策略
   */
  private selectRandom(available: TurnEntry[]): TurnEntry | undefined {
    const index = Math.floor(Math.random() * available.length);

    return available[index];
  }

  /**
   * 获取条目索引
   */
  private getEntryIndex(id: string): number {
    const entries = Array.from(this.entries.values());

    return entries.findIndex((e) => e.id === id);
  }

  /**
   * 标记轮转完成
   */
  complete(id: string): boolean {
    const entry = this.entries.get(id);

    if (!entry) {
      return false;
    }

    const event: TurnEvent = {
      entryId: id,
      type: 'completed',
      timestamp: Date.now(),
    };

    this.emit('turn:completed', event);

    return true;
  }

  /**
   * 设置冷却时间
   */
  setCooldown(id: string, cooldownMs: number): boolean {
    const entry = this.entries.get(id);

    if (!entry) {
      return false;
    }

    entry.cooldownUntil = Date.now() + cooldownMs;

    return true;
  }

  /**
   * 更新策略
   */
  setStrategy(strategy: TurnStrategy): void {
    this.config.strategy = strategy;
  }

  /**
   * 获取所有条目
   */
  getAll(): TurnEntry[] {
    return Array.from(this.entries.values());
  }

  /**
   * 获取统计数据
   */
  getStats(): {
    total: number;
    strategy: TurnStrategy;
    cooldownMs: number;
    totalTurns: number;
  } {
    let totalTurns = 0;

    for (const entry of this.entries.values()) {
      totalTurns += entry.turnCount;
    }

    return {
      total: this.entries.size,
      strategy: this.config.strategy,
      cooldownMs: this.config.cooldownMs,
      totalTurns,
    };
  }

  /**
   * 获取或创建轮转条目
   */
  getOrRegister(id: string, name: string, priority: number = 100): TurnEntry {
    const existing = this.entries.get(id);

    if (existing) {
      return existing;
    }

    this.register(id, name, priority);

    return this.entries.get(id)!;
  }
}

export const turnManager = new TurnManager();
