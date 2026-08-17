/**
 * MCP 请求并发队列
 * 读请求优先 + 超时控制 + 满队拒绝（>10 待处理）
 */

import { AppError } from '@modules/error';
import { getLogger } from '@modules/monitoring';
import type { MCPRequest, MCPRequestType, MCPResponse } from '../types';

const logger = getLogger('doc:concurrency');

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
  /** D-1：由 DocModule 注入的真实 MCP 调用执行器（未注入时请求显式失败，不做假成功） */
  private executor: ((request: MCPRequest) => Promise<MCPResponse>) | null =
    null;

  /**
   * 注入 MCP 请求执行器（DocModule 初始化时调用）
   */
  setExecutor(executor: (request: MCPRequest) => Promise<MCPResponse>): void {
    this.executor = executor;
  }

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

    // D-1 修复：定时器在 race 结束（无论胜负）后必须清理，防止每次请求泄漏定时器
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<MCPResponse>((_, reject) => {
      timer = setTimeout(
        () =>
          reject(
            new AppError(
              `MCP 请求超时 (${request.type}, ${(TIMEOUTS[request.type] || 30000) / 1000}s)`,
              'EXECUTION' as any,
              'MEDIUM' as any,
              'DOC_COMMAND_FAILED'
            )
          ),
        TIMEOUTS[request.type] || 30000
      );
    });

    try {
      return await Promise.race([this.execute(request), timeoutPromise]);
    } finally {
      if (timer) clearTimeout(timer);
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
   * D-1 修复：执行真实 MCP 调用（由 DocModule 注入 executor）；未注入时不再假装成功，
   * 而是显式失败，避免"假成功"误导上层流程
   */
  private async execute(request: MCPRequest): Promise<MCPResponse> {
    const executor = this.executor;
    if (!executor) {
      throw new AppError(
        `MCP 请求未执行（executor 未注入）: ${request.id}`,
        'EXECUTION' as any,
        'HIGH' as any,
        'DOC_COMMAND_FAILED'
      );
    }
    const start = Date.now();
    try {
      const result = await executor(request);
      return {
        requestId: request.id,
        success: result.success !== false,
        duration: Date.now() - start,
        ...(result as object),
      } as MCPResponse;
    } catch (err) {
      logger.warn('MCP 请求执行失败', {
        id: request.id,
        error: String(err),
      });
      throw err;
    }
  }
}
