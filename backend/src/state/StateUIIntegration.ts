/**
 * 状态UI集成
 *
 * 提供状态监控面板和状态历史记录功能
 */

import { Store } from './StateManager';

export interface StateHistoryEntry<T> {
  timestamp: number;
  state: T;
  action?: string;
}

export interface StateMonitorConfig {
  maxHistorySize: number;
  enableSnapshot: boolean;
  snapshotInterval: number;
}

export class StateHistory<T> {
  private history: StateHistoryEntry<T>[] = [];
  private maxSize: number;
  private snapshots: T[] = [];
  private snapshotInterval: number;
  private lastSnapshotTime: number;

  constructor(config: StateMonitorConfig) {
    this.maxSize = config.maxHistorySize;
    this.snapshotInterval = config.snapshotInterval;
    this.lastSnapshotTime = Date.now();
  }

  /**
   * 记录状态变更
   * @param state 当前状态
   * @param action 变更动作描述
   */
  record(state: T, action?: string): void {
    const entry: StateHistoryEntry<T> = {
      timestamp: Date.now(),
      state,
      action,
    };

    this.history.push(entry);

    if (this.history.length > this.maxSize) {
      this.history.shift();
    }

    if (Date.now() - this.lastSnapshotTime >= this.snapshotInterval) {
      this.takeSnapshot(state);
    }
  }

  /**
   * 拍摄状态快照
   * @param state 状态
   */
  private takeSnapshot(state: T): void {
    this.snapshots.push(state);
    this.lastSnapshotTime = Date.now();

    if (this.snapshots.length > this.maxSize) {
      this.snapshots.shift();
    }
  }

  /**
   * 获取历史记录
   */
  getHistory(): StateHistoryEntry<T>[] {
    return [...this.history];
  }

  /**
   * 获取指定时间范围的历史记录
   * @param startTime 开始时间
   * @param endTime 结束时间
   */
  getHistoryInRange(
    startTime: number,
    endTime: number
  ): StateHistoryEntry<T>[] {
    return this.history.filter(
      (entry) => entry.timestamp >= startTime && entry.timestamp <= endTime
    );
  }

  /**
   * 获取快照
   */
  getSnapshots(): T[] {
    return [...this.snapshots];
  }

  /**
   * 获取最新状态
   */
  getLatest(): T | undefined {
    return this.history[this.history.length - 1]?.state;
  }

  /**
   * 清除历史记录
   */
  clear(): void {
    this.history = [];
    this.snapshots = [];
  }

  /**
   * 获取历史记录大小
   */
  size(): number {
    return this.history.length;
  }
}

export class StateMonitor {
  private monitors: Map<string, StateMonitorInstance<any>> = new Map();

  /**
   * 创建状态监控实例
   * @param store 状态存储
   * @param name 监控名称
   * @param config 监控配置
   */
  createMonitor<T>(
    store: Store<T>,
    name: string,
    config: Partial<StateMonitorConfig> = {}
  ): StateMonitorInstance<T> {
    const fullConfig: StateMonitorConfig = {
      maxHistorySize: config.maxHistorySize ?? 100,
      enableSnapshot: config.enableSnapshot ?? true,
      snapshotInterval: config.snapshotInterval ?? 60000,
    };

    const monitor = new StateMonitorInstance<T>(store, fullConfig);
    this.monitors.set(name, monitor);
    return monitor;
  }

  /**
   * 获取监控实例
   * @param name 监控名称
   */
  getMonitor<T>(name: string): StateMonitorInstance<T> | undefined {
    return this.monitors.get(name) as StateMonitorInstance<T> | undefined;
  }

  /**
   * 获取所有监控名称
   */
  getMonitorNames(): string[] {
    return Array.from(this.monitors.keys());
  }

  /**
   * 移除监控实例
   * @param name 监控名称
   */
  removeMonitor(name: string): boolean {
    const monitor = this.monitors.get(name);
    if (monitor) {
      monitor.stop();
      return this.monitors.delete(name);
    }
    return false;
  }

  /**
   * 获取所有监控摘要
   */
  getSummary(): Record<
    string,
    {
      currentState: any;
      historySize: number;
      snapshotsCount: number;
      isMonitoring: boolean;
    }
  > {
    const summary: Record<string, any> = {};

    for (const [name, monitor] of this.monitors.entries()) {
      summary[name] = {
        currentState: monitor.getCurrentState(),
        historySize: monitor.getHistory().length,
        snapshotsCount: monitor.getSnapshots().length,
        isMonitoring: monitor.isMonitoring(),
      };
    }

    return summary;
  }
}

export class StateMonitorInstance<T> {
  private store: Store<T>;
  private history: StateHistory<T>;
  private unsubscribe: (() => void) | null = null;
  private monitoring: boolean = false;
  private lastState: T | undefined;

  constructor(store: Store<T>, config: StateMonitorConfig) {
    this.store = store;
    this.history = new StateHistory<T>(config);
    this.lastState = store.getState();
  }

  /**
   * 开始监控
   */
  start(): void {
    if (this.monitoring) {
      return;
    }

    this.unsubscribe = this.store.subscribe(() => {
      const currentState = this.store.getState();
      const action = this.detectAction(this.lastState, currentState);
      this.history.record(currentState, action);
      this.lastState = currentState;
    });

    this.monitoring = true;
    this.history.record(this.store.getState(), 'initial');
  }

  /**
   * 停止监控
   */
  stop(): void {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
    this.monitoring = false;
  }

  /**
   * 检测状态变更动作
   * @param oldState 旧状态
   * @param newState 新状态
   */
  private detectAction(
    oldState: T | undefined,
    newState: T
  ): string | undefined {
    if (!oldState) {
      return 'initialize';
    }

    const oldKeys = Object.keys(oldState as object);
    const newKeys = Object.keys(newState as object);

    if (oldKeys.length !== newKeys.length) {
      return 'structure_change';
    }

    for (const key of oldKeys) {
      if ((oldState as any)[key] !== (newState as any)[key]) {
        return `update:${key}`;
      }
    }

    return 'no_change';
  }

  /**
   * 获取当前状态
   */
  getCurrentState(): T {
    return this.store.getState();
  }

  /**
   * 获取历史记录
   */
  getHistory(): StateHistoryEntry<T>[] {
    return this.history.getHistory();
  }

  /**
   * 获取快照
   */
  getSnapshots(): T[] {
    return this.history.getSnapshots();
  }

  /**
   * 获取指定时间范围的历史记录
   * @param startTime 开始时间
   * @param endTime 结束时间
   */
  getHistoryInRange(
    startTime: number,
    endTime: number
  ): StateHistoryEntry<T>[] {
    return this.history.getHistoryInRange(startTime, endTime);
  }

  /**
   * 比较两个状态
   * @param state1 状态1
   * @param state2 状态2
   */
  compare(state1: T, state2: T): StateDiff {
    const diff: StateDiff = {
      added: {},
      removed: {},
      changed: {},
    };

    const keys1 = Object.keys(state1 as object);
    const keys2 = Object.keys(state2 as object);

    for (const key of keys2) {
      if (!(key in (state1 as object))) {
        diff.added[key] = (state2 as any)[key];
      } else if (!Object.is((state1 as any)[key], (state2 as any)[key])) {
        diff.changed[key] = {
          oldValue: (state1 as any)[key],
          newValue: (state2 as any)[key],
        };
      }
    }

    for (const key of keys1) {
      if (!(key in (state2 as object))) {
        diff.removed[key] = (state1 as any)[key];
      }
    }

    return diff;
  }

  /**
   * 是否正在监控
   */
  isMonitoring(): boolean {
    return this.monitoring;
  }

  /**
   * 获取状态历史大小
   */
  getHistorySize(): number {
    return this.history.size();
  }

  /**
   * 清除历史记录
   */
  clear(): void {
    this.history.clear();
  }
}

export interface StateDiff {
  added: Record<string, any>;
  removed: Record<string, any>;
  changed: Record<string, { oldValue: any; newValue: any }>;
}

export const globalStateMonitor = new StateMonitor();

export default globalStateMonitor;
