/**
 * ChannelHealthMonitor 通道健康监控
 * 基于 HealthChecker 实现通道级健康检查与告警
 */
import { EventEmitter } from 'events';
import { HealthChecker } from '../../monitoring/health/HealthChecker';
import type {
  HealthCheckResult,
  HealthStatus,
} from '../../monitoring/health/HealthChecker';
import { ChannelRegistry } from '../registry/ChannelRegistry';
import { getLogger } from '../../monitoring/logs/Logger';
const logger = getLogger('channels:health');

export interface HealthAlert {
  channelId: string;
  previous: HealthStatus;
  current: HealthStatus;
  timestamp: number;
  error?: string;
}

export interface ChannelHealthReport {
  channelId: string;
  healthy: boolean;
  connected: boolean;
  latencyMs: number;
  lastChecked: number;
  status: HealthStatus;
  error?: string;
}

export interface ChannelHealthMonitorConfig {
  checkIntervalMs: number;
  checkTimeoutMs: number;
  autoStart: boolean;
  notifyOnChange: boolean;
}

const DEFAULT_CONFIG: ChannelHealthMonitorConfig = {
  checkIntervalMs: 60000,
  checkTimeoutMs: 5000,
  autoStart: true,
  notifyOnChange: true,
};

export class ChannelHealthMonitor extends EventEmitter {
  private checker: HealthChecker;
  private registry: ChannelRegistry;
  private config: ChannelHealthMonitorConfig;
  private channelStatuses: Map<string, HealthStatus> = new Map();
  private autoTimer: NodeJS.Timeout | null = null;

  constructor(
    registry: ChannelRegistry,
    config?: Partial<ChannelHealthMonitorConfig>
  ) {
    super();
    this.registry = registry;
    this.checker = new HealthChecker();
    this.config = { ...DEFAULT_CONFIG, ...config };

    if (this.config.autoStart) {
      this.registerAllChannels();
      this.startAutoCheck();
    }
  }

  /**
   * 注册所有通道为健康检查项
   * 幂等：registerCheck 为 Map.set 覆盖，可安全重复调用，
   * 因此每次 checkAll/getReport 前调用可覆盖动态注册的新通道（P3）
   */
  registerAllChannels(): void {
    const channels = this.registry.getAll();

    for (const ch of channels) {
      this.registerChannel(ch.name);
    }
  }

  /**
   * 注册单个通道
   */
  registerChannel(name: string): void {
    this.checker.registerCheck(
      `channel:${name}`,
      async () => {
        const ch = this.registry.get(name);
        if (!ch) {
          return {
            status: 'unhealthy' as HealthStatus,
            details: { error: '通道未注册' },
          };
        }
        return {
          status: ch.connected
            ? ('healthy' as HealthStatus)
            : ('unhealthy' as HealthStatus),
          details: {
            connected: ch.connected,
            type: ch.type,
            enabled: ch.enabled,
          },
        };
      },
      { timeout: this.config.checkTimeoutMs }
    );
  }

  /**
   * 注销通道健康检查
   */
  unregisterChannel(name: string): void {
    this.checker.unregisterCheck(`channel:${name}`);
    this.channelStatuses.delete(name);
  }

  /**
   * 运行所有通道健康检查
   */
  async checkAll(): Promise<HealthCheckResult> {
    // P3：动态注册的通道不在初始 registerAllChannels 范围，运行前同步一次
    this.registerAllChannels();
    const result = await this.checker.runAllChecks();
    this.evaluateAlerts(result);
    this.emit('health:updated', result);
    return result;
  }

  /**
   * 运行单个通道健康检查
   */
  async checkChannel(name: string): Promise<ChannelHealthReport | null> {
    const result = await this.checker.runCheck(`channel:${name}`);
    if (!result) return null;

    const ch = this.registry.get(name);
    return {
      channelId: name,
      healthy: result.status === 'healthy',
      connected: ch?.connected ?? false,
      latencyMs: result.latency,
      lastChecked: result.lastChecked,
      status: result.status,
      error: result.error,
    };
  }

  /**
   * 获取所有通道健康报告
   */
  async getReport(): Promise<ChannelHealthReport[]> {
    // P3：动态注册的通道不在初始 registerAllChannels 范围，查询前同步一次
    this.registerAllChannels();
    const channels = this.registry.getAll();
    const reports: ChannelHealthReport[] = [];

    for (const ch of channels) {
      const report = await this.checkChannel(ch.name);
      if (report) {
        reports.push(report);
      }
    }

    return reports;
  }

  /**
   * 获取不健康通道列表
   */
  async getUnhealthyChannels(): Promise<ChannelHealthReport[]> {
    const all = await this.getReport();
    return all.filter((r) => !r.healthy || !r.connected);
  }

  /**
   * 获取健康统计
   */
  async getStats(): Promise<{
    total: number;
    healthy: number;
    unhealthy: number;
    overallStatus: HealthStatus;
  }> {
    const result = await this.checker.runAllChecks();
    return {
      total: result.summary.total,
      healthy: result.summary.healthy,
      unhealthy: result.summary.unhealthy + result.summary.degraded,
      overallStatus: result.overall,
    };
  }

  /**
   * 评估健康状态变更并触发告警
   */
  private evaluateAlerts(result: HealthCheckResult): void {
    if (!this.config.notifyOnChange) return;

    for (const check of result.checks) {
      const channelId = check.name.replace('channel:', '');
      const previous = this.channelStatuses.get(channelId);
      const current = check.status;

      if (previous && previous !== current) {
        const alert: HealthAlert = {
          channelId,
          previous,
          current,
          timestamp: check.lastChecked,
          error: check.error,
        };

        logger.warn(`通道健康状态变更: ${channelId} ${previous} → ${current}`, {
          alert,
        });
        this.emit('channel:alert', alert);
      }

      this.channelStatuses.set(channelId, current);
    }
  }

  /**
   * 启动自动检查
   */
  startAutoCheck(): void {
    this.stop();
    // P3：unref() 避免健康检查定时器阻止进程退出
    this.autoTimer = setInterval(() => {
      this.checkAll();
    }, this.config.checkIntervalMs).unref();
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<ChannelHealthMonitorConfig>): void {
    this.config = { ...this.config, ...config };

    if (config.checkIntervalMs) {
      this.startAutoCheck();
    }
  }

  /**
   * 停止全部检查
   */
  stop(): void {
    if (this.autoTimer) {
      clearInterval(this.autoTimer);
      this.autoTimer = null;
    }
  }
}
