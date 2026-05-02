/**
 * 工具执行器（基于CC源码）
 * 负责工具的实际执行、调度和性能优化
 */

import { 
  ToolExecutionContext, 
  ToolExecutionResult,
  ToolExecutionOptions,
  ToolExecutionStats,
  ToolExecutionLog,
  ToolErrorCode
} from '../types/ToolTypes';

/**
 * 工具执行器类（基于CC源码）
 */
export class ToolExecutor {
  private concurrentExecutions: Map<string, Promise<ToolExecutionResult>> = new Map();
  private executionStats: Map<string, ToolExecutionStats> = new Map();
  private executionLogs: Map<string, ToolExecutionLog[]> = new Map();

  /**
   * 执行工具（基于CC源码）
   */
  async executeTool(
    toolName: string,
    implementation: (context: ToolExecutionContext) => Promise<ToolExecutionResult>,
    context: ToolExecutionContext,
    options: ToolExecutionOptions = {}
  ): Promise<ToolExecutionResult> {
    const executionId = context.executionId;
    
    // 检查是否已有相同执行ID的执行
    if (this.concurrentExecutions.has(executionId)) {
      throw new Error(`执行ID已存在: ${executionId}`);
    }
    
    // 创建执行Promise
    const executionPromise = this.createExecutionPromise(
      toolName,
      implementation,
      context,
      options
    );
    
    // 记录并发执行
    this.concurrentExecutions.set(executionId, executionPromise);
    
    try {
      // 等待执行完成
      const result = await executionPromise;
      
      // 记录执行结果
      this.recordExecutionResult(toolName, executionId, result, true);
      
      return result;
    } catch (error) {
      // 记录执行错误
      this.recordExecutionResult(toolName, executionId, {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        errorCode: ToolErrorCode.EXECUTION_FAILED,
        executionTime: 0,
        startTime: new Date(),
        endTime: new Date(),
        stats: {},
        logs: []
      }, false);
      
      throw error;
    } finally {
      // 清理并发执行记录
      this.concurrentExecutions.delete(executionId);
    }
  }

  /**
   * 创建执行Promise（基于CC源码）
   */
  private async createExecutionPromise(
    toolName: string,
    implementation: (context: ToolExecutionContext) => Promise<ToolExecutionResult>,
    context: ToolExecutionContext,
    options: ToolExecutionOptions
  ): Promise<ToolExecutionResult> {
    const startTime = Date.now();
    const logs: ToolExecutionLog[] = [];
    
    // 添加开始日志
    this.addExecutionLog(logs, 'info', `开始执行工具: ${toolName}`);
    
    try {
      // 执行工具
      const result = await implementation(context);
      
      const executionTime = Date.now() - startTime;
      
      // 添加成功日志
      this.addExecutionLog(logs, 'info', `工具执行成功: ${toolName} (${executionTime}ms)`);
      
      return {
        ...result,
        executionTime,
        startTime: new Date(startTime),
        endTime: new Date(),
        logs
      };
    } catch (error) {
      const executionTime = Date.now() - startTime;
      
      // 添加错误日志
      this.addExecutionLog(logs, 'error', `工具执行失败: ${toolName} - ${error}`);
      
      throw error;
    }
  }

  /**
   * 记录执行结果（基于CC源码）
   */
  private recordExecutionResult(
    toolName: string,
    executionId: string,
    result: ToolExecutionResult,
    success: boolean
  ): void {
    // 更新执行统计
    this.updateExecutionStats(toolName, result.executionTime, success);
    
    // 记录执行日志
    this.executionLogs.set(executionId, result.logs);
    
    // 清理过期的执行日志
    this.cleanupExpiredLogs();
  }

  /**
   * 更新执行统计（基于CC源码）
   */
  private updateExecutionStats(toolName: string, executionTime: number, success: boolean): void {
    const stats = this.executionStats.get(toolName) || {
      executionCount: 0,
      averageExecutionTime: 0,
      successRate: 0,
      totalExecutionTime: 0,
      successfulExecutions: 0,
      failedExecutions: 0
    };
    
    stats.executionCount++;
    stats.totalExecutionTime += executionTime;
    stats.averageExecutionTime = stats.totalExecutionTime / stats.executionCount;
    
    if (success) {
      stats.successfulExecutions++;
    } else {
      stats.failedExecutions++;
    }
    
    stats.successRate = (stats.successfulExecutions / stats.executionCount) * 100;
    
    this.executionStats.set(toolName, stats);
  }

  /**
   * 添加执行日志（基于CC源码）
   */
  private addExecutionLog(
    logs: ToolExecutionLog[],
    level: 'debug' | 'info' | 'warn' | 'error',
    message: string,
    data?: any
  ): void {
    logs.push({
      timestamp: new Date(),
      level,
      message,
      data
    });
  }

  /**
   * 清理过期的执行日志（基于CC源码）
   */
  private cleanupExpiredLogs(): void {
    const now = Date.now();
    const retentionTime = 24 * 60 * 60 * 1000; // 24小时
    
    for (const [executionId, logs] of this.executionLogs.entries()) {
      if (logs.length > 0) {
        const lastLogTime = logs[logs.length - 1].timestamp.getTime();
        
        if (now - lastLogTime > retentionTime) {
          this.executionLogs.delete(executionId);
        }
      }
    }
  }

  /**
   * 获取执行统计（基于CC源码）
   */
  getExecutionStats(toolName?: string): ToolExecutionStats | Map<string, ToolExecutionStats> {
    if (toolName) {
      return this.executionStats.get(toolName) || {
        executionCount: 0,
        averageExecutionTime: 0,
        successRate: 0,
        totalExecutionTime: 0,
        successfulExecutions: 0,
        failedExecutions: 0
      };
    }
    
    return new Map(this.executionStats);
  }

  /**
   * 获取执行日志（基于CC源码）
   */
  getExecutionLogs(executionId: string): ToolExecutionLog[] {
    return this.executionLogs.get(executionId) || [];
  }

  /**
   * 获取当前并发执行数（基于CC源码）
   */
  getConcurrentExecutionCount(): number {
    return this.concurrentExecutions.size;
  }

  /**
   * 获取活跃执行ID列表（基于CC源码）
   */
  getActiveExecutionIds(): string[] {
    return Array.from(this.concurrentExecutions.keys());
  }

  /**
   * 取消执行（基于CC源码）
   */
  async cancelExecution(executionId: string): Promise<boolean> {
    const executionPromise = this.concurrentExecutions.get(executionId);
    
    if (!executionPromise) {
      return false;
    }
    
    // 这里可以实现更复杂的取消逻辑
    // 目前只是从并发执行记录中移除
    this.concurrentExecutions.delete(executionId);
    
    return true;
  }

  /**
   * 重置执行器（基于CC源码）
   */
  reset(): void {
    this.concurrentExecutions.clear();
    this.executionStats.clear();
    this.executionLogs.clear();
  }
}

/**
 * 全局工具执行器实例（基于CC源码）
 */
export const globalToolExecutor = new ToolExecutor();

export default ToolExecutor;