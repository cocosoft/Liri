/**
 * 心跳管理器
 * 负责定期发送心跳保持会话活跃
 */

import { BridgeApiClient } from '../types';

/**
 * 心跳信息
 */
interface HeartbeatInfo {
  /** 工作ID */
  workId: string;
  /** 会话令牌 */
  sessionToken: string;
  /** 最后心跳时间 */
  lastHeartbeatTime: number;
}

/**
 * 心跳管理器选项
 */
interface HeartbeatManagerOptions {
  /** Bridge API客户端 */
  api: BridgeApiClient;
  /** 环境ID */
  environmentId: string;
  /** 心跳间隔（毫秒） */
  heartbeatIntervalMs: number;
  /** 错误回调 */
  onError: (error: Error) => void;
  /** 中止信号 */
  signal?: AbortSignal;
}

/**
 * 心跳管理器
 */
export class HeartbeatManager {
  private readonly api: BridgeApiClient;
  private readonly environmentId: string;
  private readonly heartbeatIntervalMs: number;
  private readonly onError: (error: Error) => void;
  private readonly signal?: AbortSignal;
  private isRunning = false;
  private sessions: Map<string, HeartbeatInfo> = new Map();
  private heartbeatTimer: NodeJS.Timeout | null = null;

  constructor(options: HeartbeatManagerOptions) {
    this.api = options.api;
    this.environmentId = options.environmentId;
    this.heartbeatIntervalMs = options.heartbeatIntervalMs;
    this.onError = options.onError;
    this.signal = options.signal;
  }

  /**
   * 开始心跳
   */
  start(): void {
    if (this.isRunning) {
      return;
    }

    this.isRunning = true;
    this.startHeartbeatTimer();
  }

  /**
   * 停止心跳
   */
  stop(): void {
    this.isRunning = false;
    this.clearHeartbeatTimer();
  }

  /**
   * 添加会话
   */
  addSession(sessionId: string, workId: string, sessionToken: string): void {
    this.sessions.set(sessionId, {
      workId,
      sessionToken,
      lastHeartbeatTime: Date.now(),
    });
  }

  /**
   * 移除会话
   */
  removeSession(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  /**
   * 开始心跳定时器
   */
  private startHeartbeatTimer(): void {
    this.clearHeartbeatTimer();

    const timer = setInterval(async () => {
      await this.sendHeartbeats();
    }, this.heartbeatIntervalMs);

    this.heartbeatTimer = timer;

    // 如果有中止信号，取消定时器
    if (this.signal) {
      this.signal.addEventListener(
        'abort',
        () => {
          this.clearHeartbeatTimer();
        },
        { once: true }
      );
    }
  }

  /**
   * 清除心跳定时器
   */
  private clearHeartbeatTimer(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  /**
   * 发送心跳
   */
  private async sendHeartbeats(): Promise<void> {
    if (!this.isRunning || this.signal?.aborted) {
      return;
    }

    // 发送所有会话的心跳
    for (const [sessionId, info] of this.sessions.entries()) {
      try {
        await this.api.heartbeatWork(
          this.environmentId,
          info.workId,
          info.sessionToken
        );

        // 更新最后心跳时间
        info.lastHeartbeatTime = Date.now();
      } catch (error) {
        // 处理心跳错误
        this.onError(error instanceof Error ? error : new Error(String(error)));
      }
    }
  }

  /**
   * 获取会话心跳信息
   */
  getSessionHeartbeatInfo(sessionId: string): HeartbeatInfo | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * 获取活跃会话数量
   */
  getActiveSessionCount(): number {
    return this.sessions.size;
  }
}

/**
 * 创建心跳管理器
 */
export function createHeartbeatManager(
  options: HeartbeatManagerOptions
): HeartbeatManager {
  return new HeartbeatManager(options);
}
