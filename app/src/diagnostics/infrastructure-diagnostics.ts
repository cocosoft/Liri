/**
 * infrastructure-diagnostics.ts — 基础设施诊断模块
 *
 * 提供：
 * - Provider 健康检查（通过 HealthChecker 注册）
 * - Event Loop 滞后监控
 * - SystemHealthChecker 集成
 */

import { HealthChecker } from '@modules/monitoring/health/HealthChecker.js';
import { systemHealthChecker } from '@modules/diagnostics/SystemHealthChecker.js';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger.js';

const logger = new Logger({ level: LogLevel.INFO });

/** 全局 HealthChecker 实例 */
export const infraHealthChecker = new HealthChecker();

/**
 * Event Loop 滞后检测
 * 通过测量 setTimeout 的回调延迟来判断 Event Loop 是否阻塞
 */
class EventLoopLagMonitor {
  private intervalHandle: ReturnType<typeof setInterval> | null = null;
  private readonly checkIntervalMs: number;

  constructor(checkIntervalMs = 5000) {
    this.checkIntervalMs = checkIntervalMs;
  }

  /** 启动周期性滞后检测 */
  start(): void {
    if (this.intervalHandle) return;

    const intervalMs = this.checkIntervalMs;
    const jitter = Math.floor(Math.random() * 100);

    let lastTick = Date.now();

    this.intervalHandle = setInterval(() => {
      const now = Date.now();
      const expectedDelay = intervalMs;
      const actualDelay = now - lastTick;
      const lag = Math.max(0, actualDelay - expectedDelay - jitter);

      lastTick = now;

      if (lag > 500) {
        logger.warn(`Event Loop 滞后: ${lag}ms`, {
          expectedDelay: expectedDelay,
          actualDelay: actualDelay,
          lagMs: lag,
        });
      }
    }, intervalMs);

    this.intervalHandle.unref();
  }

  /** 停止滞后检测 */
  stop(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }
}

/** 全局 Event Loop 滞后监视器实例 */
export const eventLoopMonitor = new EventLoopLagMonitor();

/**
 * 初始化基础设施诊断
 * 注册所有健康检查并启动 Event Loop 监控
 *
 * 调用位置：LocalHTTPService 构造函数
 */
export function setupInfrastructureDiagnostics(): void {
  // 1. 注册 SystemHealthChecker 作为 HealthChecker 的一项检查
  infraHealthChecker.registerCheck(
    'system-health',
    async () => {
      const report = await systemHealthChecker.performFullCheck();
      const unhealthyCount = report.checks.filter(
        (c) => c.status === 'unhealthy' || c.status === 'critical'
      ).length;
      const warningCount = report.checks.filter(
        (c) => c.status === 'warning' || c.status === 'degraded'
      ).length;

      return {
        status:
          report.overallStatus === 'healthy' ||
          report.overallStatus === 'warning'
            ? ('healthy' as const)
            : ('unhealthy' as const),
        details: {
          overallStatus: report.overallStatus,
          checkCount: report.checks.length,
          unhealthyCount,
          warningCount,
          recommendations: report.recommendations,
        },
      };
    },
    { interval: 60000, timeout: 15000, critical: true }
  );

  // 2. 注册 Event Loop 滞后检查
  infraHealthChecker.registerCheck(
    'event-loop-lag',
    async () => {
      const start = Date.now();
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      const lag = Date.now() - start;

      return {
        status:
          lag > 500
            ? ('unhealthy' as const)
            : lag > 100
              ? ('degraded' as const)
              : ('healthy' as const),
        details: { lagMs: lag },
      };
    },
    { interval: 10000, timeout: 3000, critical: false }
  );

  // 3. 注册 Provider 可用性检查
  infraHealthChecker.registerCheck(
    'providers-status',
    async () => {
      const providerInfo: Record<string, unknown> = {};

      try {
        const { STTRegistry } =
          await import('@modules/services/voice/services/sttRegistry');
        providerInfo.sttProviders = STTRegistry.getProviderIds();
      } catch {
        providerInfo.sttProviders = [];
      }

      try {
        const { TTSRegistry } =
          await import('@modules/services/voice/services/ttsProvider');
        providerInfo.ttsProviders = TTSRegistry.getProviderNames();
      } catch {
        providerInfo.ttsProviders = [];
      }

      try {
        const { channelRegistry } =
          await import('@modules/channels/registry/ChannelRegistry');
        providerInfo.channelNames = channelRegistry
          .getAll()
          .map((ch) => ch.name);
      } catch {
        providerInfo.channelNames = [];
      }

      const totalProviders =
        (providerInfo.sttProviders as string[]).length +
        (providerInfo.ttsProviders as string[]).length +
        (providerInfo.channelNames as string[]).length;

      // 没有注册任何 Provider 是正常的（可能延迟注册），标记为 healthy
      return {
        status: 'healthy' as const,
        details: {
          totalProviders,
          ...providerInfo,
        },
      };
    },
    { interval: 60000, timeout: 5000, critical: false }
  );

  // 4. 启动 Event Loop 滞后监控
  eventLoopMonitor.start();

  logger.info('基础设施诊断已初始化', {
    checks: ['system-health', 'event-loop-lag', 'providers-status'],
  });
}
