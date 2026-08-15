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
import { getLogger } from '@modules/monitoring/logs/Logger.js';
const logger = getLogger('diagnostics:infrastructure-diagnostics');

/** 全局 HealthChecker 实例 */
export const infraHealthChecker = new HealthChecker();

/** 睡眠唤醒判定阈值：系统睡眠期间 setTimeout 不触发，唤醒后延迟一次性累积 */
export const SLEEP_WAKE_LAG_MS = 60_000;

/**
 * 分类 Event Loop 滞后（评审 2026-08-15：08-10 日志曾把 158 分钟"滞后"误报为阻塞，
 * 实为系统睡眠唤醒——睡眠期间计时器不触发，唤醒后延迟累积）。
 * - >60s：疑似睡眠唤醒，降级为 info（非持续阻塞，避免误导排查）
 * - 2s~60s：真实滞后，保留 warn
 * - ≤2s：正常抖动，静默
 */
export function classifyEventLoopLag(lagMs: number): {
  warn: boolean;
  sleepWake: boolean;
} {
  if (lagMs > SLEEP_WAKE_LAG_MS) return { warn: false, sleepWake: true };
  if (lagMs > 2000) return { warn: true, sleepWake: false };
  return { warn: false, sleepWake: false };
}

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

      const { warn, sleepWake } = classifyEventLoopLag(lag);
      if (sleepWake) {
        // 睡眠唤醒：非持续阻塞，info 级别并明确标注，避免误判为事件循环卡死
        logger.info(
          `Event Loop 唤醒恢复（疑似睡眠唤醒，非持续阻塞）：延迟 ${lag}ms`,
          {
            expectedDelay,
            actualDelay,
            lagMs: lag,
            sleepWake: true,
          }
        );
      } else if (warn) {
        // 复检报告（2026-08-14 第三轮）建议：原阈值 500ms 偏严——秒级滞后（891/1982ms）
        // 属正常 GC/文件操作抖动，每 5s 一条 warn 淹没其他日志。上调至 2000ms，
        // 仅 ≥2s 的真实阻塞（事件循环明显停摆）保留告警。
        // #59-2 归因辅助：附加内存快照——heapUsed 接近 heapTotal（GC 前）或
        // rss/external 突增，提示滞后窗口可能是 V8 GC/大对象分配；配合
        // sqlite3 慢查询插桩（core:external:sqlite3）可区分 DB 阻塞 vs GC。
        const mem = process.memoryUsage();
        logger.warn(`Event Loop 滞后: ${lag}ms`, {
          expectedDelay: expectedDelay,
          actualDelay: actualDelay,
          lagMs: lag,
          memRssMb: Math.round(mem.rss / 1024 / 1024),
          heapUsedMb: Math.round(mem.heapUsed / 1024 / 1024),
          heapTotalMb: Math.round(mem.heapTotal / 1024 / 1024),
          externalMb: Math.round(mem.external / 1024 / 1024),
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
