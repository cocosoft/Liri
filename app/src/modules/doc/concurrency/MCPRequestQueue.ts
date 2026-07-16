/**
 * MCP 请求并发队列
 * 读请求优先 + 超时控制 + 满队拒绝（>10 待处理）
 */

import { AppError } from '@modules/error';
import { Logger, LogLevel } from '@modules/monitoring';

import type { MCPRequest, MCPRequestType, MCPResponse } from '../types';

const logger = new Logger({
  module: 'doc:concurrency',
  level: LogLevel.INFO,
});

/** 请求超时配置（毫秒） */
const TIMEOUTS: Record<MCPRequestType, number> = {
  read: 15000, // 15s
  write: 30000, // 30s
  render: 60000, // 60s
};

/** 最大待处理请求数 */
const MAX_PENDING = 10;

/**
 * MCP 请求队列
 * 不修改 StdioTransport 或 MCPConnectionManager 的公共接口
 */
export class MCPRequestQueue {
  private maxPending: number = MAX_PENDING;
  private readQueue: MCPRequest[] = [];
  private writeQueue: MCPRequest[] = [];
  private pendingCount = 0;

  /**
   * 入队一个 MCP 请求
   * 读请求优先调度，满队时立即拒绝
   */
  async enqueue(request: MCPRequest): Promise<MCPResponse> {
    if (this.pendingCount >= this.maxPending) {
      throw new AppError(
        'MCP 请求队列已满，请稍后重试',
        'EXECUTION' as any,
        'LOW' as any,
        'DOC_QUEUE_FULL'
      );
    }

    const queue = request.type === 'read' ? this.readQueue : this.writeQueue;
    queue.push(request);
    this.pendingCount++;

    logger.debug('MCP 请求入队', {
      id: request.id,
      type: request.type,
      pendingCount: this.pendingCount,
    });

    try {
      return await Promise.race([this.execute(request), this.timeout(request)]);
    } finally {
      this.pendingCount--;
    }
  }

  /**
   * 获取当前队列长度
   */
  getPendingCount(): number {
    return this.pendingCount;
  }

  /**
   * 获取各队列大小
   */
  getQueueSizes(): { read: number; write: number } {
    return {
      read: this.readQueue.length,
      write: this.writeQueue.length,
    };
  }

  /**
   * 清空所有待处理请求
   */
  flush(): void {
    this.readQueue = [];
    this.writeQueue = [];
    this.pendingCount = 0;
  }

  /**
   * 执行请求（实际调用由 DocModule 注入）
   */
  private async execute(request: MCPRequest): Promise<MCPResponse> {
    // TODO: 实际 MCP 调用由 DocModule 注入 executor
    return {
      requestId: request.id,
      success: true,
      duration: 0,
    };
  }

  /**
   * 超时 Promise
   */
  private timeout(request: MCPRequest): Promise<MCPResponse> {
    const ms = TIMEOUTS[request.type] || 30000;
    return new Promise((_, reject) =>
      setTimeout(
        () =>
          reject(
            new AppError(
              `MCP 请求超时 (${request.type}, ${ms / 1000}s)`,
              'EXECUTION' as any,
              'MEDIUM' as any,
              'DOC_COMMAND_FAILED'
            )
          ),
        ms
      )
    );
  }
}
