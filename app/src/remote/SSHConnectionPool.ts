//
/**
 * SSH连接池
 * 管理SSH连接的生命周期，支持连接复用、心跳检测和自动重连
 */

import { SSHConnection, SSHConfig, SSHConnectionStatus } from './SSHConnection';

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({ module: 'remote:SSHConnectionPool', level: LogLevel.INFO });

/**
 * 连接池配置
 */
export interface SSHConnectionPoolConfig {
  /**
   * 最大连接数（默认 10）
   */
  maxConnections?: number;

  /**
   * 空闲连接超时（毫秒，默认 300000 = 5分钟）
   */
  idleTimeout?: number;

  /**
   * 连接心跳间隔（毫秒，默认 60000 = 1分钟）
   */
  keepAliveInterval?: number;

  /**
   * 最大重试次数（默认 3）
   */
  maxRetries?: number;

  /**
   * 重试间隔（毫秒，默认 5000）
   */
  retryDelay?: number;
}

/**
 * 连接池条目
 */
interface PoolEntry {
  /**
   * 连接实例
   */
  connection: SSHConnection;

  /**
   * 连接配置（作为唯一标识）
   */
  configKey: string;

  /**
   * 最后使用时间
   */
  lastUsed: number;

  /**
   * 创建时间
   */
  createdAt: number;

  /**
   * 重试次数
   */
  retryCount: number;

  /**
   * 是否正在使用
   */
  inUse: boolean;
}

/**
 * SSH连接池
 */
export class SSHConnectionPool {
  private pool: Map<string, PoolEntry> = new Map();
  private config: Required<SSHConnectionPoolConfig>;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;
  private keepAliveTimer: ReturnType<typeof setInterval> | null = null;

  constructor(config: SSHConnectionPoolConfig = {}) {
    this.config = {
      maxConnections: config.maxConnections || 10,
      idleTimeout: config.idleTimeout || 300000,
      keepAliveInterval: config.keepAliveInterval || 60000,
      maxRetries: config.maxRetries || 3,
      retryDelay: config.retryDelay || 5000,
    };
  }

  /**
   * 初始化连接池
   */
  initialize(): void {
    this.startCleanupTimer();
    this.startKeepAliveTimer();
  }

  /**
   * 从连接池获取连接
   * 如果存在可用连接则复用，否则创建新连接
   */
  async getConnection(config: SSHConfig): Promise<SSHConnection> {
    const configKey = this.buildConfigKey(config);

    let entry = this.findAvailableEntry(configKey);
    if (entry) {
      entry.inUse = true;
      entry.lastUsed = Date.now();
      return entry.connection;
    }

    if (this.pool.size >= this.config.maxConnections) {
      this.evictOne();
    }

    const connection = new SSHConnection(config);

    entry = {
      connection,
      configKey,
      lastUsed: Date.now(),
      createdAt: Date.now(),
      retryCount: 0,
      inUse: true,
    };

    this.pool.set(configKey, entry);
    return connection;
  }

  /**
   * 释放连接回连接池
   */
  releaseConnection(config: SSHConfig): void {
    const configKey = this.buildConfigKey(config);
    const entry = this.pool.get(configKey);
    if (entry) {
      entry.inUse = false;
      entry.lastUsed = Date.now();
    }
  }

  /**
   * 从连接池移除并断开连接
   */
  async removeConnection(config: SSHConfig): Promise<void> {
    const configKey = this.buildConfigKey(config);
    const entry = this.pool.get(configKey);
    if (entry) {
      entry.connection.disconnect();
      this.pool.delete(configKey);
    }
  }

  /**
   * 获取连接池统计信息
   */
  getStats(): {
    totalConnections: number;
    activeConnections: number;
    idleConnections: number;
    maxConnections: number;
  } {
    let active = 0;
    let idle = 0;

    for (const entry of this.pool.values()) {
      if (entry.inUse) {
        active++;
      } else {
        idle++;
      }
    }

    return {
      totalConnections: this.pool.size,
      activeConnections: active,
      idleConnections: idle,
      maxConnections: this.config.maxConnections,
    };
  }

  /**
   * 关闭所有连接
   */
  shutdown(): void {
    this.stopTimers();
    for (const [, entry] of this.pool) {
      try {
        entry.connection.disconnect();
      } catch (err) {

        // ignore disconnect errors during shutdown

        logger.debug("Operation skipped", { context: "ignore disconnect errors during shutdown", error: err instanceof Error ? err.message : String(err) });

      }
    }
    this.pool.clear();
  }

  /**
   * 构建连接配置的哈希键
   */
  private buildConfigKey(config: SSHConfig): string {
    return `${config.username}@${config.host}:${config.port || 22}`;
  }

  /**
   * 查找可用的连接条目
   */
  private findAvailableEntry(configKey: string): PoolEntry | undefined {
    const entry = this.pool.get(configKey);
    if (entry && !entry.inUse) {
      const status = entry.connection.getStatus();
      if (status === SSHConnectionStatus.CONNECTED) {
        return entry;
      }
    }
    return undefined;
  }

  /**
   * 驱逐一个连接（LRU策略）
   */
  private evictOne(): void {
    let oldest: PoolEntry | null = null;
    let oldestKey: string | null = null;

    for (const [key, entry] of this.pool) {
      if (!entry.inUse) {
        if (!oldest || entry.lastUsed < oldest.lastUsed) {
          oldest = entry;
          oldestKey = key;
        }
      }
    }

    if (oldestKey && oldest) {
      oldest.connection.disconnect();
      this.pool.delete(oldestKey);
    }
  }

  /**
   * 启动清理定时器
   */
  private startCleanupTimer(): void {
    this.cleanupTimer = setInterval(
      () => {
        const now = Date.now();
        for (const [key, entry] of this.pool) {
          if (!entry.inUse && now - entry.lastUsed > this.config.idleTimeout) {
            entry.connection.disconnect();
            this.pool.delete(key);
          }
        }
      },
      Math.min(this.config.idleTimeout / 2, 60000)
    );
  }

  /**
   * 启动心跳定时器
   */
  private startKeepAliveTimer(): void {
    this.keepAliveTimer = setInterval(() => {
      for (const [, entry] of this.pool) {
        if (entry.inUse) {
          const status = entry.connection.getStatus();
          if (status === SSHConnectionStatus.CONNECTED) {
            entry.connection.executeCommand('echo keepalive').catch(() => {});
          }
        }
      }
    }, this.config.keepAliveInterval);
  }

  /**
   * 停止所有定时器
   */
  private stopTimers(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    if (this.keepAliveTimer) {
      clearInterval(this.keepAliveTimer);
      this.keepAliveTimer = null;
    }
  }
}
