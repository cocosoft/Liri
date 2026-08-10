/**
 * 插件健康监控器
 * 心跳检测 + 崩溃恢复
 * 监控每个插件的运行状态，检测无响应或崩溃后进行自动恢复
 */

import { getLogger } from '@modules/monitoring';
import { handleError } from '@modules/error/handleError';

const logger = getLogger('sandbox:pluginHealthMonitor');

/**
 * 插件健康状态
 */
export enum PluginHealthStatus {
  HEALTHY = 'healthy',
  DEGRADED = 'degraded',
  UNRESPONSIVE = 'unresponsive',
  CRASHED = 'crashed',
  RECOVERING = 'recovering',
}

/**
 * 插件心跳记录
 */
export interface HeartbeatRecord {
  pluginId: string;
  lastHeartbeatAt: number;
  heartbeatIntervalMs: number;
  missedBeatCount: number;
  status: PluginHealthStatus;
}

/**
 * 崩溃事件
 */
export interface CrashEvent {
  pluginId: string;
  crashedAt: number;
  reason: string;
  error?: string;
  recovered: boolean;
  recoveryAttempts: number;
}

/**
 * 恢复策略
 */
export interface RecoveryStrategy {
  /** 最大恢复尝试次数 */
  maxAttempts: number;
  /** 恢复间隔（毫秒） */
  retryIntervalMs: number;
  /** 是否在恢复后重新激活 */
  reactivateAfterRecovery: boolean;
}

/**
 * 恢复回调
 * 当插件被标记为崩溃时调用，应返回 true 表示恢复成功
 */
export type RecoveryHandler = (
  pluginId: string,
  crashEvent: CrashEvent
) => Promise<boolean>;

const DEFAULT_RECOVERY_STRATEGY: RecoveryStrategy = {
  maxAttempts: 3,
  retryIntervalMs: 5000,
  reactivateAfterRecovery: true,
};

/**
 * 健康监控配置
 */
export interface PluginHealthMonitorConfig {
  /** 健康检查间隔（毫秒），默认 10000 */
  checkIntervalMs: number;
  /** 最大允许的心跳丢失次数，默认 3 */
  maxMissedBeats: number;
  /** 心跳超时（毫秒），默认 30000 */
  heartbeatTimeoutMs: number;
  /** 恢复策略 */
  recoveryStrategy: RecoveryStrategy;
}

const DEFAULT_CONFIG: PluginHealthMonitorConfig = {
  checkIntervalMs: 10000,
  maxMissedBeats: 3,
  heartbeatTimeoutMs: 30000,
  recoveryStrategy: { ...DEFAULT_RECOVERY_STRATEGY },
};

/**
 * 插件健康监控器
 */
export class PluginHealthMonitor {
  private config: PluginHealthMonitorConfig;
  private heartbeats: Map<string, HeartbeatRecord> = new Map();
  private crashHistory: CrashEvent[] = [];
  private recoveryHandlers: Map<string, RecoveryHandler> = new Map();
  private checkTimer: NodeJS.Timeout | null = null;
  private recoveryInProgress: Set<string> = new Set();
  private _maxCrashHistory: number = 100;

  /**
   * 崩溃事件回调
   */
  public onCrash: ((event: CrashEvent) => void) | null = null;

  /**
   * 恢复成功回调
   */
  public onRecovery: ((pluginId: string) => void) | null = null;

  constructor(config?: Partial<PluginHealthMonitorConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * 注册插件心跳
   * 插件应在初始化/activate 时调用此方法
   * @param pluginId 插件 ID
   * @param intervalMs 心跳间隔（毫秒），默认使用配置值
   */
  registerPlugin(pluginId: string, intervalMs?: number): void {
    this.heartbeats.set(pluginId, {
      pluginId,
      lastHeartbeatAt: Date.now(),
      heartbeatIntervalMs: intervalMs || this.config.heartbeatTimeoutMs,
      missedBeatCount: 0,
      status: PluginHealthStatus.HEALTHY,
    });
    logger.info(`Plugin ${pluginId} registered for health monitoring`);
  }

  /**
   * 注销插件心跳
   * @param pluginId 插件 ID
   */
  unregisterPlugin(pluginId: string): void {
    this.heartbeats.delete(pluginId);
    this.recoveryHandlers.delete(pluginId);
    logger.info(`Plugin ${pluginId} unregistered from health monitoring`);
  }

  /**
   * 记录心跳
   * 插件应定期调用此方法报告存活状态
   * @param pluginId 插件 ID
   */
  recordHeartbeat(pluginId: string): void {
    const record = this.heartbeats.get(pluginId);
    if (!record) {
      this.registerPlugin(pluginId);
      return;
    }

    record.lastHeartbeatAt = Date.now();
    record.missedBeatCount = 0;
    record.status = PluginHealthStatus.HEALTHY;
  }

  /**
   * 注册恢复处理器
   * @param pluginId 插件 ID
   * @param handler 恢复回调
   */
  setRecoveryHandler(pluginId: string, handler: RecoveryHandler): void {
    this.recoveryHandlers.set(pluginId, handler);
  }

  /**
   * 获取插件健康状态
   * @param pluginId 插件 ID
   */
  getStatus(pluginId: string): PluginHealthStatus | undefined {
    return this.heartbeats.get(pluginId)?.status;
  }

  /**
   * 获取所有插件的健康记录
   */
  getAllStatus(): HeartbeatRecord[] {
    return Array.from(this.heartbeats.values());
  }

  /**
   * 获取健康插件列表
   */
  getHealthyPlugins(): string[] {
    const result: string[] = [];
    for (const [id, record] of this.heartbeats) {
      if (record.status === PluginHealthStatus.HEALTHY) {
        result.push(id);
      }
    }
    return result;
  }

  /**
   * 获取崩溃/无响应的插件列表
   */
  getUnhealthyPlugins(): string[] {
    const result: string[] = [];
    for (const [id, record] of this.heartbeats) {
      if (
        record.status === PluginHealthStatus.UNRESPONSIVE ||
        record.status === PluginHealthStatus.CRASHED
      ) {
        result.push(id);
      }
    }
    return result;
  }

  /**
   * 获取崩溃历史
   */
  getCrashHistory(limit?: number): CrashEvent[] {
    const sorted = [...this.crashHistory].sort(
      (a, b) => b.crashedAt - a.crashedAt
    );
    return limit ? sorted.slice(0, limit) : sorted;
  }

  /**
   * 启动健康检查
   */
  start(): void {
    if (this.checkTimer) return;
    this.checkTimer = setInterval(() => {
      this.performHealthCheck();
    }, this.config.checkIntervalMs);
    logger.info(
      `Plugin health monitor started (interval: ${this.config.checkIntervalMs}ms)`
    );
  }

  /**
   * 停止健康检查
   */
  stop(): void {
    if (this.checkTimer) {
      clearInterval(this.checkTimer);
      this.checkTimer = null;
    }
    logger.info('Plugin health monitor stopped');
  }

  /**
   * 清理所有记录
   */
  reset(): void {
    this.stop();
    this.heartbeats.clear();
    this.crashHistory = [];
    this.recoveryHandlers.clear();
  }

  /**
   * 执行健康检查
   */
  private async performHealthCheck(): Promise<void> {
    const now = Date.now();
    const timeout = this.config.heartbeatTimeoutMs;

    for (const [pluginId, record] of this.heartbeats.entries()) {
      if (this.recoveryInProgress.has(pluginId)) continue;

      const elapsed = now - record.lastHeartbeatAt;

      if (elapsed > timeout) {
        record.missedBeatCount++;

        if (record.missedBeatCount >= this.config.maxMissedBeats) {
          const oldStatus = record.status;
          record.status = PluginHealthStatus.CRASHED;

          if (oldStatus !== PluginHealthStatus.CRASHED) {
            const crashEvent: CrashEvent = {
              pluginId,
              crashedAt: now,
              reason: `Missed ${record.missedBeatCount} heartbeats (last: ${elapsed}ms ago)`,
              recovered: false,
              recoveryAttempts: 0,
            };

            this.crashHistory.push(crashEvent);
            if (this.crashHistory.length > this._maxCrashHistory) {
              this.crashHistory.shift();
            }

            logger.error(`Plugin ${pluginId} crashed: ${crashEvent.reason}`);

            if (this.onCrash) {
              this.onCrash(crashEvent);
            }

            await this.attemptRecovery(pluginId, crashEvent);
          }
        } else {
          record.status = PluginHealthStatus.UNRESPONSIVE;
          logger.warn(
            `Plugin ${pluginId} unresponsive (missed ${record.missedBeatCount}/${this.config.maxMissedBeats} beats)`
          );
        }
      } else if (
        record.status === PluginHealthStatus.DEGRADED ||
        record.status === PluginHealthStatus.UNRESPONSIVE
      ) {
        if (record.missedBeatCount === 0) {
          record.status = PluginHealthStatus.HEALTHY;
        }
      }
    }
  }

  /**
   * 尝试恢复崩溃的插件
   */
  private async attemptRecovery(
    pluginId: string,
    crashEvent: CrashEvent
  ): Promise<void> {
    const handler = this.recoveryHandlers.get(pluginId);
    if (!handler) {
      logger.warn(
        `No recovery handler registered for plugin ${pluginId}, skipping recovery`
      );
      return;
    }

    this.recoveryInProgress.add(pluginId);
    const record = this.heartbeats.get(pluginId);
    if (record) {
      record.status = PluginHealthStatus.RECOVERING;
    }

    const strategy = this.config.recoveryStrategy;
    let recovered = false;

    for (let attempt = 1; attempt <= strategy.maxAttempts; attempt++) {
      logger.info(
        `Recovery attempt ${attempt}/${strategy.maxAttempts} for plugin ${pluginId}`
      );

      try {
        const updatedEvent: CrashEvent = {
          ...crashEvent,
          recoveryAttempts: attempt,
        };

        recovered = await handler(pluginId, updatedEvent);

        if (recovered) {
          crashEvent.recovered = true;
          logger.info(
            `Plugin ${pluginId} recovered successfully after ${attempt} attempts`
          );

          if (record) {
            record.lastHeartbeatAt = Date.now();
            record.missedBeatCount = 0;
            record.status = PluginHealthStatus.HEALTHY;
          }

          if (this.onRecovery) {
            this.onRecovery(pluginId);
          }
          break;
        }
      } catch (error) {
        void handleError(error, {
          module: 'sandbox:health',
          action: 'attemptRecovery',
        });
        logger.error(
          `Recovery attempt ${attempt} for plugin ${pluginId} failed:`,
          { error }
        );
      }

      if (attempt < strategy.maxAttempts) {
        await this.sleep(strategy.retryIntervalMs);
      }
    }

    if (!recovered) {
      logger.error(
        `Plugin ${pluginId} could not be recovered after ${strategy.maxAttempts} attempts`
      );
    }

    this.recoveryInProgress.delete(pluginId);
  }

  /**
   * 异步睡眠
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
