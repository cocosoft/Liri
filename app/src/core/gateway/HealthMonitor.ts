import { EventEmitter } from 'node:events';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import { handleError } from '@modules/error/handleError';
import type { GatewayChannel } from './types';
import { ChannelStatus } from './types';

const logger = new Logger({ level: LogLevel.INFO, module: 'gateway:health' });

export interface HealthConfig {
  checkIntervalMs?: number;
  pingTimeoutMs?: number;
  maxFailedPings?: number;
  recoveryCheckIntervalMs?: number;
  latencyWarningThresholdMs?: number;
}

/**
 * 通道健康状态
 *
 * @deprecated 请使用 @modules/core/health/types.js 的 HealthStatus（字符串联合类型）作为标准健康状态。
 *   此 interface 是通道健康检查结果对象（含 connected/latencyMs 等运行时字段），与标准 HealthStatus
 *   （'healthy'|'degraded'|'unhealthy' 等枚举值）概念不同。
 *   新代码中如需表示通道健康状态值，应使用 core/health 的 HealthStatus 类型。
 *   如需完整的健康检查结果对象，请定义新类型（如 ChannelHealthResult）替代。
 */
export interface HealthStatus {
  channelName: string;
  connected: boolean;
  latencyMs: number;
  lastPingAt: number;
  lastPongAt: number;
  failedPings: number;
  status: ChannelStatus;
  healthy: boolean;
  message: string;
  details?: Record<string, unknown>;
}

export interface HealthReport {
  timestamp: number;
  totalChannels: number;
  healthyCount: number;
  unhealthyCount: number;
  statuses: HealthStatus[];
}

const DEFAULT_CONFIG: Required<HealthConfig> = {
  checkIntervalMs: 30_000,
  pingTimeoutMs: 5_000,
  maxFailedPings: 3,
  recoveryCheckIntervalMs: 10_000,
  latencyWarningThresholdMs: 2_000,
};

export enum HealthEvent {
  CHECK_COMPLETE = 'health:check_complete',
  CHANNEL_UNHEALTHY = 'health:channel_unhealthy',
  CHANNEL_RECOVERED = 'health:channel_recovered',
  LATENCY_WARNING = 'health:latency_warning',
}

/**
 * 健康监控器
 *
 * @deprecated 请使用 @modules/core/events/EventBus 的 EventBusImpl 替代 Node.js EventEmitter。
 *   此类继承自 Node.js EventEmitter，属于事件孤岛。
 *   新代码应通过 EventBusImpl 订阅/发布事件（subscribe/publish），
 *   而非通过 EventEmitter 的 on/emit。
 *   此文件将在未来版本中移除或重构。
 */
export class HealthMonitor extends EventEmitter {
  readonly name = 'HealthMonitor';
  private config: Required<HealthConfig>;
  private channels: Map<string, GatewayChannel> = new Map();
  private healthStatuses: Map<string, HealthStatus> = new Map();
  private checkTimer: ReturnType<typeof setInterval> | null = null;
  private recoveryTimers: Map<string, ReturnType<typeof setInterval>> =
    new Map();
  private isRunning = false;

  constructor(config?: HealthConfig) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  registerChannel(channel: GatewayChannel): void {
    this.channels.set(channel.name, channel);
    this.healthStatuses.set(channel.name, {
      channelName: channel.name,
      connected: channel.isConnected(),
      latencyMs: 0,
      lastPingAt: 0,
      lastPongAt: 0,
      failedPings: 0,
      status: channel.status,
      healthy: channel.isConnected(),
      message: '已注册',
    });
    logger.info(`HealthMonitor: 通道已注册监听 — ${channel.name}`);
  }

  unregisterChannel(name: string): void {
    this.channels.delete(name);
    this.healthStatuses.delete(name);
    this.stopRecoveryTimer(name);
    logger.info(`HealthMonitor: 通道已移除监听 — ${name}`);
  }

  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;

    this.checkTimer = setInterval(() => {
      this.runHealthCheck().catch(async (err) => {
        await handleError(err, { module: 'gateway:health', action: 'health_check_interval' });
      });
    }, this.config.checkIntervalMs);

    logger.info(
      `HealthMonitor: 已启动 (间隔 ${this.config.checkIntervalMs}ms)`
    );
  }

  stop(): void {
    this.isRunning = false;

    if (this.checkTimer) {
      clearInterval(this.checkTimer);
      this.checkTimer = null;
    }

    for (const [name] of this.recoveryTimers) {
      this.stopRecoveryTimer(name);
    }

    logger.info('HealthMonitor: 已停止');
  }

  async runHealthCheck(): Promise<HealthReport> {
    const now = Date.now();
    const results: HealthStatus[] = [];

    const checkPromises = Array.from(this.channels.entries()).map(
      async ([name, channel]) => {
        const existing = this.getOrCreateStatus(name, channel);

        try {
          const pingStart = Date.now();
          const isConnected = await channel.healthCheck();
          const latency = Date.now() - pingStart;

          existing.lastPingAt = now;
          existing.latencyMs = latency;
          existing.connected = isConnected;
          existing.status = channel.status;

          if (isConnected) {
            existing.lastPongAt = now;
            existing.failedPings = 0;

            if (latency > this.config.latencyWarningThresholdMs) {
              existing.message = `高延迟: ${latency}ms`;
              this.emit(HealthEvent.LATENCY_WARNING, { ...existing });
            } else {
              existing.message = '健康';
            }

            if (!existing.healthy) {
              existing.healthy = true;
              existing.message = '已恢复';
              this.emit(HealthEvent.CHANNEL_RECOVERED, { ...existing });
              this.stopRecoveryTimer(name);
            }
          } else {
            existing.failedPings++;
            existing.message = `连接丢失 (失败 ${existing.failedPings}/${this.config.maxFailedPings})`;

            if (existing.failedPings >= this.config.maxFailedPings) {
              existing.healthy = false;
              this.emit(HealthEvent.CHANNEL_UNHEALTHY, { ...existing });
              this.startRecoveryTimer(name, channel);
            }
          }
        } catch (error) {
          existing.failedPings++;
          existing.message = `检查异常: ${error instanceof Error ? error.message : String(error)}`;
          existing.healthy = false;
          this.emit(HealthEvent.CHANNEL_UNHEALTHY, { ...existing });
        }

        results.push({ ...existing });
        this.healthStatuses.set(name, existing);
      }
    );

    await Promise.allSettled(checkPromises);

    const report: HealthReport = {
      timestamp: Date.now(),
      totalChannels: results.length,
      healthyCount: results.filter((r) => r.healthy).length,
      unhealthyCount: results.filter((r) => !r.healthy).length,
      statuses: results,
    };

    this.emit(HealthEvent.CHECK_COMPLETE, report);
    return report;
  }

  async checkChannel(name: string): Promise<HealthStatus> {
    const channel = this.channels.get(name);
    if (!channel) {
      return {
        channelName: name,
        healthy: false,
        connected: false,
        status: ChannelStatus.DISCONNECTED,
        message: '通道未注册',
        lastPingAt: 0,
        lastPongAt: 0,
        latencyMs: 0,
        failedPings: 0,
      };
    }

    const existing = this.getOrCreateStatus(name, channel);

    try {
      const pingStart = Date.now();
      const isConnected = await channel.healthCheck();
      existing.latencyMs = Date.now() - pingStart;
      existing.connected = isConnected;
      existing.lastPingAt = Date.now();

      if (isConnected) {
        existing.lastPongAt = Date.now();
        existing.failedPings = 0;
        existing.healthy = true;
        existing.message = '健康';
      } else {
        existing.failedPings++;
        existing.message = `连接丢失 (失败 ${existing.failedPings}/${this.config.maxFailedPings})`;
        if (existing.failedPings >= this.config.maxFailedPings) {
          existing.healthy = false;
        }
      }
    } catch (error) {
      existing.failedPings++;
      existing.message = `检查异常: ${error instanceof Error ? error.message : String(error)}`;
    }

    this.healthStatuses.set(name, { ...existing });
    return { ...existing };
  }

  getChannelHealth(name: string): HealthStatus | undefined {
    const status = this.healthStatuses.get(name);
    return status ? { ...status } : undefined;
  }

  getAllHealthStatuses(): HealthStatus[] {
    return Array.from(this.healthStatuses.values()).map((s) => ({ ...s }));
  }

  getOverallHealth(): boolean {
    if (this.healthStatuses.size === 0) return true;
    return Array.from(this.healthStatuses.values()).every((s) => s.healthy);
  }

  private getOrCreateStatus(
    name: string,
    channel: GatewayChannel
  ): HealthStatus {
    const existing = this.healthStatuses.get(name);
    if (existing) return existing;

    const status: HealthStatus = {
      channelName: name,
      connected: channel.isConnected(),
      latencyMs: 0,
      lastPingAt: 0,
      lastPongAt: 0,
      failedPings: 0,
      status: channel.status,
      healthy: channel.isConnected(),
      message: '初始化',
    };
    this.healthStatuses.set(name, status);
    return status;
  }

  private startRecoveryTimer(name: string, channel: GatewayChannel): void {
    if (this.recoveryTimers.has(name)) return;

    const timer = setInterval(async () => {
      try {
        const isConnected = await channel.healthCheck();
        if (isConnected) {
          const status = this.healthStatuses.get(name);
          if (status) {
            status.healthy = true;
            status.failedPings = 0;
            status.message = '已恢复';
            status.lastPongAt = Date.now();
            status.connected = true;
            this.emit(HealthEvent.CHANNEL_RECOVERED, { ...status });
          }
          this.stopRecoveryTimer(name);
          logger.info(`HealthMonitor: 通道 ${name} 已自动恢复`);
        }
      } catch (err) {
        logger.warning('[HealthMonitor] 通道恢复检查失败:', err);
      }
    }, this.config.recoveryCheckIntervalMs);

    this.recoveryTimers.set(name, timer);
  }

  private stopRecoveryTimer(name: string): void {
    const timer = this.recoveryTimers.get(name);
    if (timer) {
      clearInterval(timer);
      this.recoveryTimers.delete(name);
    }
  }
}
