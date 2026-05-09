/**
 * 执行历史服务
 * 实现执行历史查询、清理和优化存储检索
 * 参考CC源码: cc_code/backend/utils/cronScheduler.ts
 */

import { EventEmitter } from 'events';

/**
 * 执行历史记录
 */
export interface ExecutionHistoryRecord {
  id: number;
  taskId: string;
  firedAt: number;
  completedAt?: number;
  status: 'pending' | 'running' | 'completed' | 'failed';
  result?: string;
  error?: string;
  duration?: number;
  metadata?: Record<string, unknown>;
}

/**
 * 执行历史查询选项
 */
export interface ExecutionHistoryQuery {
  taskId?: string;
  status?: 'pending' | 'running' | 'completed' | 'failed';
  startTime?: number;
  endTime?: number;
  limit?: number;
  offset?: number;
  sortBy?: 'firedAt' | 'completedAt' | 'duration';
  sortOrder?: 'asc' | 'desc';
}

/**
 * 执行历史统计
 */
export interface ExecutionHistoryStats {
  totalRecords: number;
  pendingCount: number;
  runningCount: number;
  completedCount: number;
  failedCount: number;
  averageDuration: number;
  totalDuration: number;
  lastRecordTime: number;
}

/**
 * 执行历史清理配置
 */
export interface CleanupConfig {
  maxRecords: number;
  maxAgeMs: number;
  maxAgeByStatus?: {
    pending?: number;
    running?: number;
    completed?: number;
    failed?: number;
  };
  autoCleanupEnabled: boolean;
  cleanupIntervalMs: number;
}

/**
 * 执行历史服务类
 */
export class ExecutionHistoryService extends EventEmitter {
  private static instance: ExecutionHistoryService;
  private history: ExecutionHistoryRecord[] = [];
  private nextId: number = 1;
  private maxRecords: number = 10000;
  private cleanupTimer: NodeJS.Timeout | null = null;
  private cleanupConfig: CleanupConfig = {
    maxRecords: 10000,
    maxAgeMs: 30 * 24 * 60 * 60 * 1000,
    autoCleanupEnabled: false,
    cleanupIntervalMs: 60 * 60 * 1000,
  };

  private constructor() {
    super();
  }

  /**
   * 获取单例实例
   */
  static getInstance(): ExecutionHistoryService {
    if (!ExecutionHistoryService.instance) {
      ExecutionHistoryService.instance = new ExecutionHistoryService();
    }
    return ExecutionHistoryService.instance;
  }

  /**
   * 添加执行历史记录
   * @param taskId 任务ID
   * @param firedAt 开始时间
   * @param metadata 元数据
   * @returns 记录ID
   */
  addRecord(
    taskId: string,
    firedAt: number,
    metadata?: Record<string, unknown>
  ): number {
    const id = this.nextId++;

    const record: ExecutionHistoryRecord = {
      id,
      taskId,
      firedAt,
      status: 'pending',
      metadata,
    };

    this.history.push(record);

    if (this.history.length > this.maxRecords) {
      this.trimHistory();
    }

    this.emit('recordAdded', record);

    return id;
  }

  /**
   * 更新执行历史记录
   * @param id 记录ID
   * @param updates 更新内容
   */
  updateRecord(id: number, updates: Partial<ExecutionHistoryRecord>): void {
    const index = this.history.findIndex((r) => r.id === id);
    if (index === -1) {
      return;
    }

    const updatedRecord = { ...this.history[index], ...updates };

    if (updates.completedAt && updatedRecord.firedAt) {
      updatedRecord.duration = updates.completedAt - updatedRecord.firedAt;
    }

    this.history[index] = updatedRecord;

    this.emit('recordUpdated', updatedRecord);
  }

  /**
   * 标记记录完成
   * @param id 记录ID
   * @param result 结果
   */
  markCompleted(id: number, result?: string): void {
    this.updateRecord(id, {
      status: 'completed',
      completedAt: Date.now(),
      result,
    });
  }

  /**
   * 标记记录失败
   * @param id 记录ID
   * @param error 错误信息
   */
  markFailed(id: number, error: string): void {
    this.updateRecord(id, {
      status: 'failed',
      completedAt: Date.now(),
      error,
    });
  }

  /**
   * 标记记录进行中
   * @param id 记录ID
   */
  markRunning(id: number): void {
    this.updateRecord(id, {
      status: 'running',
    });
  }

  /**
   * 获取记录
   * @param id 记录ID
   * @returns 记录
   */
  getRecord(id: number): ExecutionHistoryRecord | undefined {
    return this.history.find((r) => r.id === id);
  }

  /**
   * 获取任务的执行历史
   * @param taskId 任务ID
   * @param limit 限制数量
   * @returns 执行历史记录
   */
  getTaskHistory(taskId: string, limit?: number): ExecutionHistoryRecord[] {
    const records = this.history
      .filter((r) => r.taskId === taskId)
      .sort((a, b) => b.firedAt - a.firedAt);

    return limit ? records.slice(0, limit) : records;
  }

  /**
   * 查询执行历史
   * @param query 查询选项
   * @returns 执行历史记录
   */
  query(query: ExecutionHistoryQuery): ExecutionHistoryRecord[] {
    let results = [...this.history];

    if (query.taskId) {
      results = results.filter((r) => r.taskId === query.taskId);
    }

    if (query.status) {
      results = results.filter((r) => r.status === query.status);
    }

    if (query.startTime !== undefined) {
      results = results.filter((r) => r.firedAt >= query.startTime!);
    }

    if (query.endTime !== undefined) {
      results = results.filter((r) => r.firedAt <= query.endTime!);
    }

    const sortBy = query.sortBy || 'firedAt';
    const sortOrder = query.sortOrder || 'desc';

    results.sort((a, b) => {
      let aVal: number | undefined;
      let bVal: number | undefined;

      switch (sortBy) {
        case 'firedAt':
          aVal = a.firedAt;
          bVal = b.firedAt;
          break;
        case 'completedAt':
          aVal = a.completedAt;
          bVal = b.completedAt;
          break;
        case 'duration':
          aVal = a.duration;
          bVal = b.duration;
          break;
      }

      if (aVal === undefined && bVal === undefined) return 0;
      if (aVal === undefined) return sortOrder === 'asc' ? 1 : -1;
      if (bVal === undefined) return sortOrder === 'asc' ? -1 : 1;

      return sortOrder === 'asc' ? aVal - bVal : bVal - aVal;
    });

    if (query.offset) {
      results = results.slice(query.offset);
    }

    if (query.limit) {
      results = results.slice(0, query.limit);
    }

    return results;
  }

  /**
   * 获取统计信息
   * @returns 统计信息
   */
  getStats(): ExecutionHistoryStats {
    const completedRecords = this.history.filter(
      (r) => r.status === 'completed'
    );
    const totalDuration = completedRecords.reduce(
      (sum, r) => sum + (r.duration || 0),
      0
    );
    const averageDuration =
      completedRecords.length > 0 ? totalDuration / completedRecords.length : 0;

    const lastRecord =
      this.history.length > 0
        ? Math.max(...this.history.map((r) => r.firedAt))
        : 0;

    return {
      totalRecords: this.history.length,
      pendingCount: this.history.filter((r) => r.status === 'pending').length,
      runningCount: this.history.filter((r) => r.status === 'running').length,
      completedCount: completedRecords.length,
      failedCount: this.history.filter((r) => r.status === 'failed').length,
      averageDuration,
      totalDuration,
      lastRecordTime: lastRecord,
    };
  }

  /**
   * 删除指定任务的执行历史
   * @param taskId 任务ID
   * @returns 删除的记录数量
   */
  deleteTaskHistory(taskId: string): number {
    const initialLength = this.history.length;
    this.history = this.history.filter((r) => r.taskId !== taskId);
    const deletedCount = initialLength - this.history.length;

    if (deletedCount > 0) {
      this.emit('taskHistoryDeleted', { taskId, count: deletedCount });
    }

    return deletedCount;
  }

  /**
   * 删除指定时间之前的执行历史
   * @param beforeTime 时间戳
   * @returns 删除的记录数量
   */
  deleteHistoryBefore(beforeTime: number): number {
    const initialLength = this.history.length;
    this.history = this.history.filter((r) => r.firedAt >= beforeTime);
    const deletedCount = initialLength - this.history.length;

    if (deletedCount > 0) {
      this.emit('historyDeleted', { beforeTime, count: deletedCount });
    }

    return deletedCount;
  }

  /**
   * 删除指定状态的执行历史
   * @param status 状态
   * @returns 删除的记录数量
   */
  deleteHistoryByStatus(
    status: 'pending' | 'running' | 'completed' | 'failed'
  ): number {
    const initialLength = this.history.length;
    this.history = this.history.filter((r) => r.status !== status);
    const deletedCount = initialLength - this.history.length;

    if (deletedCount > 0) {
      this.emit('historyDeleted', { status, count: deletedCount });
    }

    return deletedCount;
  }

  /**
   * 清理过期的执行历史
   * @returns 删除的记录数量
   */
  cleanup(): number {
    const now = Date.now();
    let deletedCount = 0;

    if (this.cleanupConfig.maxAgeMs > 0) {
      const initialLength = this.history.length;
      this.history = this.history.filter(
        (r) => now - r.firedAt < this.cleanupConfig.maxAgeMs
      );
      deletedCount += initialLength - this.history.length;
    }

    if (
      this.cleanupConfig.maxRecords > 0 &&
      this.history.length > this.cleanupConfig.maxRecords
    ) {
      const initialLength = this.history.length;
      this.trimHistory();
      deletedCount += initialLength - this.history.length;
    }

    if (this.cleanupConfig.maxAgeByStatus) {
      for (const [status, maxAge] of Object.entries(
        this.cleanupConfig.maxAgeByStatus
      )) {
        if (maxAge && maxAge > 0) {
          const initialLength = this.history.length;
          this.history = this.history.filter((r) => {
            if (r.status !== status) return true;
            return now - r.firedAt < maxAge;
          });
          deletedCount += initialLength - this.history.length;
        }
      }
    }

    if (deletedCount > 0) {
      this.emit('cleanupComplete', { deletedCount, timestamp: now });
    }

    return deletedCount;
  }

  /**
   * 裁剪历史记录到最大数量
   */
  private trimHistory(): void {
    const sortOrder = [...this.history].sort((a, b) => b.firedAt - a.firedAt);
    this.history = sortOrder.slice(0, this.maxRecords);
  }

  /**
   * 设置清理配置
   * @param config 清理配置
   */
  setCleanupConfig(config: Partial<CleanupConfig>): void {
    this.cleanupConfig = { ...this.cleanupConfig, ...config };

    if (this.cleanupConfig.autoCleanupEnabled && !this.cleanupTimer) {
      this.startAutoCleanup();
    } else if (!this.cleanupConfig.autoCleanupEnabled && this.cleanupTimer) {
      this.stopAutoCleanup();
    }
  }

  /**
   * 获取清理配置
   * @returns 清理配置
   */
  getCleanupConfig(): CleanupConfig {
    return { ...this.cleanupConfig };
  }

  /**
   * 启动自动清理
   */
  startAutoCleanup(): void {
    if (this.cleanupTimer) {
      return;
    }

    this.cleanupConfig.autoCleanupEnabled = true;

    this.cleanupTimer = setInterval(() => {
      this.cleanup();
    }, this.cleanupConfig.cleanupIntervalMs);

    this.emit('autoCleanupStarted');
  }

  /**
   * 停止自动清理
   */
  stopAutoCleanup(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
      this.cleanupConfig.autoCleanupEnabled = false;
      this.emit('autoCleanupStopped');
    }
  }

  /**
   * 获取最近的成功执行记录
   * @param limit 限制数量
   * @returns 成功执行记录
   */
  getRecentSuccesses(limit: number = 10): ExecutionHistoryRecord[] {
    return this.query({
      status: 'completed',
      sortBy: 'completedAt',
      sortOrder: 'desc',
      limit,
    });
  }

  /**
   * 获取最近的失败执行记录
   * @param limit 限制数量
   * @returns 失败执行记录
   */
  getRecentFailures(limit: number = 10): ExecutionHistoryRecord[] {
    return this.query({
      status: 'failed',
      sortBy: 'completedAt',
      sortOrder: 'desc',
      limit,
    });
  }

  /**
   * 获取任务成功率
   * @param taskId 任务ID
   * @returns 成功率（0-1）
   */
  getTaskSuccessRate(taskId: string): number {
    const taskHistory = this.getTaskHistory(taskId);
    if (taskHistory.length === 0) {
      return 0;
    }

    const completedCount = taskHistory.filter(
      (r) => r.status === 'completed'
    ).length;
    return completedCount / taskHistory.length;
  }

  /**
   * 获取任务平均执行时间
   * @param taskId 任务ID
   * @returns 平均执行时间（毫秒）
   */
  getTaskAverageDuration(taskId: string): number {
    const taskHistory = this.getTaskHistory(taskId);
    const completedRecords = taskHistory.filter(
      (r) => r.status === 'completed' && r.duration !== undefined
    );

    if (completedRecords.length === 0) {
      return 0;
    }

    const totalDuration = completedRecords.reduce(
      (sum, r) => sum + (r.duration || 0),
      0
    );
    return totalDuration / completedRecords.length;
  }

  /**
   * 清除所有执行历史
   */
  clearAllHistory(): void {
    const count = this.history.length;
    this.history = [];
    this.nextId = 1;
    this.emit('historyCleared', { count });
  }

  /**
   * 导出执行历史
   * @param format 导出格式
   * @returns 导出的数据
   */
  exportHistory(format: 'json' | 'csv' = 'json'): string {
    if (format === 'json') {
      return JSON.stringify(this.history, null, 2);
    }

    if (format === 'csv') {
      const headers = [
        'id',
        'taskId',
        'firedAt',
        'completedAt',
        'status',
        'result',
        'error',
        'duration',
      ];
      const rows = this.history.map((r) =>
        [
          r.id,
          r.taskId,
          r.firedAt,
          r.completedAt || '',
          r.status,
          r.result || '',
          r.error || '',
          r.duration || '',
        ].join(',')
      );

      return [headers.join(','), ...rows].join('\n');
    }

    return '';
  }

  /**
   * 重置服务
   */
  reset(): void {
    this.stopAutoCleanup();
    this.clearAllHistory();
    this.removeAllListeners();
  }
}

/**
 * 导出单例
 */
export const executionHistoryService = ExecutionHistoryService.getInstance();
