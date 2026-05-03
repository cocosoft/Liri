// @ts-nocheck
/**
 * 任务执行历史服务
 * 管理任务执行历史记录
 */

import { TaskExecutionRecord, EnhancedCronTask } from './EnhancedCronTask.js';

/**
 * 执行历史查询选项
 */
export interface ExecutionHistoryQueryOptions {
  /** 任务ID */
  taskId?: string;
  /** 状态筛选 */
  status?: string;
  /** 开始时间 */
  startTime?: number;
  /** 结束时间 */
  endTime?: number;
  /** 页码 */
  page?: number;
  /** 每页数量 */
  pageSize?: number;
  /** 排序字段 */
  sortBy?: keyof TaskExecutionRecord;
  /** 排序方向 */
  sortOrder?: 'asc' | 'desc';
}

/**
 * 执行历史查询结果
 */
export interface ExecutionHistoryQueryResult {
  /** 记录列表 */
  records: TaskExecutionRecord[];
  /** 总记录数 */
  total: number;
  /** 页码 */
  page: number;
  /** 每页数量 */
  pageSize: number;
  /** 总页数 */
  totalPages: number;
}

/**
 * 任务执行历史服务
 */
export class TaskExecutionHistoryService {
  private static instance: TaskExecutionHistoryService;
  private executionRecords: Map<string, TaskExecutionRecord[]> = new Map();

  private constructor() {}

  /**
   * 获取单例实例
   */
  static getInstance(): TaskExecutionHistoryService {
    if (!TaskExecutionHistoryService.instance) {
      TaskExecutionHistoryService.instance = new TaskExecutionHistoryService();
    }
    return TaskExecutionHistoryService.instance;
  }

  /**
   * 记录任务执行
   */
  recordExecution(task: EnhancedCronTask, record: TaskExecutionRecord): void {
    if (!this.executionRecords.has(task.id)) {
      this.executionRecords.set(task.id, []);
    }

    const records = this.executionRecords.get(task.id)!;
    records.push(record);

    // 限制历史记录数量
    if (task.maxHistory && records.length > task.maxHistory) {
      records.splice(0, records.length - task.maxHistory);
    }
  }

  /**
   * 获取任务执行历史
   */
  getTaskHistory(taskId: string): TaskExecutionRecord[] {
    return this.executionRecords.get(taskId) || [];
  }

  /**
   * 查询执行历史
   */
  queryExecutionHistory(options: ExecutionHistoryQueryOptions = {}): ExecutionHistoryQueryResult {
    const {
      taskId,
      status,
      startTime,
      endTime,
      page = 1,
      pageSize = 10,
      sortBy = 'timestamp',
      sortOrder = 'desc',
    } = options;

    // 收集所有符合条件的记录
    let allRecords: TaskExecutionRecord[] = [];

    if (taskId) {
      // 只查询指定任务的记录
      const taskRecords = this.executionRecords.get(taskId) || [];
      allRecords = taskRecords;
    } else {
      // 查询所有任务的记录
      for (const records of this.executionRecords.values()) {
        allRecords = [...allRecords, ...records];
      }
    }

    // 筛选
    let filteredRecords = allRecords.filter(record => {
      // 状态筛选
      if (status && record.status !== status) {
        return false;
      }

      // 时间筛选
      if (startTime && record.timestamp < startTime) {
        return false;
      }
      if (endTime && record.timestamp > endTime) {
        return false;
      }

      return true;
    });

    // 排序
    filteredRecords.sort((a, b) => {
      const aValue = a[sortBy];
      const bValue = b[sortBy];

      if (aValue < bValue) {
        return sortOrder === 'asc' ? -1 : 1;
      }
      if (aValue > bValue) {
        return sortOrder === 'asc' ? 1 : -1;
      }
      return 0;
    });

    // 分页
    const total = filteredRecords.length;
    const totalPages = Math.ceil(total / pageSize);
    const startIndex = (page - 1) * pageSize;
    const endIndex = startIndex + pageSize;
    const paginatedRecords = filteredRecords.slice(startIndex, endIndex);

    return {
      records: paginatedRecords,
      total,
      page,
      pageSize,
      totalPages,
    };
  }

  /**
   * 获取任务的最后一次执行记录
   */
  getLastExecution(taskId: string): TaskExecutionRecord | null {
    const records = this.executionRecords.get(taskId) || [];
    if (records.length === 0) {
      return null;
    }

    // 按时间戳降序排序，返回第一条
    return records
      .sort((a, b) => b.timestamp - a.timestamp)
      .find(() => true) || null;
  }

  /**
   * 获取任务的执行统计
   */
  getExecutionStats(taskId: string): {
    total: number;
    success: number;
    failed: number;
    averageDuration: number | null;
  } {
    const records = this.executionRecords.get(taskId) || [];
    
    const total = records.length;
    const success = records.filter(r => r.status === 'success').length;
    const failed = records.filter(r => r.status === 'failed').length;
    
    const durations = records
      .filter(r => r.duration !== undefined)
      .map(r => r.duration!);
    const averageDuration = durations.length > 0
      ? durations.reduce((sum, duration) => sum + duration, 0) / durations.length
      : null;

    return {
      total,
      success,
      failed,
      averageDuration,
    };
  }

  /**
   * 清理任务执行历史
   */
  cleanupTaskHistory(taskId: string, keepCount?: number): void {
    const records = this.executionRecords.get(taskId);
    if (!records) {
      return;
    }

    if (keepCount && records.length > keepCount) {
      // 保留最近的N条记录
      const sortedRecords = records.sort((a, b) => b.timestamp - a.timestamp);
      const keptRecords = sortedRecords.slice(0, keepCount);
      this.executionRecords.set(taskId, keptRecords);
    } else {
      // 清空所有记录
      this.executionRecords.delete(taskId);
    }
  }

  /**
   * 清理所有执行历史
   */
  cleanupAllHistory(): void {
    this.executionRecords.clear();
  }

  /**
   * 导出执行历史
   */
  exportHistory(): Record<string, TaskExecutionRecord[]> {
    return Object.fromEntries(this.executionRecords);
  }

  /**
   * 导入执行历史
   */
  importHistory(history: Record<string, TaskExecutionRecord[]>): void {
    this.executionRecords = new Map(Object.entries(history));
  }
}

/**
 * 获取任务执行历史服务实例
 */
export function getTaskExecutionHistoryService(): TaskExecutionHistoryService {
  return TaskExecutionHistoryService.getInstance();
}
