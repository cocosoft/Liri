/**
 * OpenTelemetry 观测系统初始化
 * 从 AppCore.ts 提取，集中管理遥测初始化逻辑。
 *
 * 职责：
 * - 注册全局 MeterProvider/TracerProvider
 * - 创建 MetricsBridge（MetricsService → OTelMetrics）
 * - 创建 TraceBridge
 * - 初始化集中日志配置
 * - 创建 OTel 日志适配器
 * - 启用 Logger → OTel LogHandler 桥接
 * - 启动 AITracePlugin（含失败模式防护 + 心跳自检）
 * - 启动 HeartbeatMonitor 监控自检
 */

import { Logger } from '@modules/monitoring';
import { handleError } from '@modules/error';

const logger = new Logger({ module: 'AppCore' });

/**
 * 初始化 OpenTelemetry 观测系统
 */
export async function initializeOTelSystem(): Promise<void> {
  // 启动监控心跳自检（最先启动，后续各模块注册）
  const { HeartbeatMonitor } =
    await import('@modules/monitoring/HeartbeatMonitor.js');
  const heartbeat = HeartbeatMonitor.getInstance();
  heartbeat.register('core:otel');
  heartbeat.start();

  try {
    const { initializeTelemetry } =
      await import('@modules/monitoring/instrumentation.js');

    await initializeTelemetry();
    logger.info('OTel 遥测初始化完成');

    // 主动创建 OTel 指标实例（注册到全局 MeterProvider）
    const { getOTelMetrics, getOTelTracing } =
      await import('@modules/monitoring/otel/index.js');

    const otelMetrics = getOTelMetrics();
    const otelTracing = getOTelTracing();

    // 创建并启动 MetricsBridge（MetricsService → OTelMetrics）
    const { getMetricsService, createMetricsBridge } =
      await import('@modules/monitoring/index.js');

    const metricsService = getMetricsService();
    const metricsBridge = createMetricsBridge(metricsService, otelMetrics);
    metricsBridge.start();

    // 创建 TraceBridge 供追踪使用
    const { createTraceBridge } =
      await import('@modules/monitoring/otel/index.js');

    const traceBridge = createTraceBridge(otelTracing);

    // 初始化会话追踪
    const { getSessionTracing } =
      await import('@modules/monitoring/tracing/SessionTracing.js');

    getSessionTracing();

    // 初始化 EventBus ↔ OTel Span 桥接
    const { initEventBusOTelBridge } =
      await import('./events/EventBusOTelBridge.js');
    initEventBusOTelBridge();
    logger.info('EventBus ↔ OTel Span 桥接初始化完成');

    // 初始化 TokenTracker（Token 成本追踪和预算控制）
    const { getTokenTracker } = await import('./events/TokenTracker.js');
    getTokenTracker();
    logger.info('TokenTracker 初始化完成');

    // 初始化 OrchestrationMetrics（后端编排指标统计）
    const { getOrchestrationMetrics } =
      await import('./events/OrchestrationMetrics.js');
    const orchMetrics = getOrchestrationMetrics();
    // 对接 OTel Metrics，使编排指标通过 OTel 导出
    orchMetrics.setOTelMetrics(otelMetrics);
    logger.info('OrchestrationMetrics 初始化完成');

    logger.info('OTel 桥接组件初始化完成');

    // 初始化集中日志配置（LogConfigManager 注册到 Logger）
    const { logConfigManager } =
      await import('@modules/monitoring/logs/config/LogConfig.js');
    const { setGlobalConfigProvider, setGlobalBufferConfig } =
      await import('@modules/monitoring/logs/Logger.js');
    const cfg = logConfigManager.get();
    setGlobalConfigProvider(() => {
      return {
        level: cfg.level,
        logFile: cfg.targets.find((t) => t.type === 'file')?.path,
        fileOutput: cfg.targets.some((t) => t.type === 'file'),
        format: cfg.format === 'pretty' ? 'text' : cfg.format,
        colorize: cfg.colorize,
        otelTraceEnabled: cfg.otelTraceEnabled,
      };
    });
    setGlobalBufferConfig(cfg.maxBufferSize, cfg.flushInterval);
    logger.info('集中日志配置已注册');

    // 创建 OTel 日志适配器（将 OTel Span 上下文注入日志）
    const { createOTelLoggerAdapter, registerOTelLogHandler } =
      await import('@modules/monitoring/otel/OTelLoggerAdapter.js');
    const otelAdapter = createOTelLoggerAdapter(otelTracing, {
      module: 'app',
      traceEnabled: true,
      jsonOutput: true,
    });
    logger.info('OTel 日志适配器已创建');

    // P0-2.2: 启用 Logger → OTel LogHandler 桥接
    // 确保所有 Logger（非 OTelAwareLogger）输出也携带 traceId/spanId
    registerOTelLogHandler(otelAdapter);
    logger.info('Logger → OTel LogHandler 桥接已启用');

    // P0-2.1b: 启动 AI Trace 录制（含失败模式防护 + 心跳自检）
    await startAITracePlugin(otelTracing, heartbeat);

    // P3-2.12: 初始化告警桥接（抑制 + 路由 + 通道分发）
    const { getAlertBridge } =
      await import('@modules/monitoring/alerts/AlertBridge.js');
    getAlertBridge().init();
    heartbeat.register('alert-bridge');
    logger.info('AlertBridge 告警桥接已初始化');

    // 心跳保活：所有注册模块需要定期 beat() 否则 5 分钟后被标记为 dead
    const HEARTBEAT_INTERVAL = 4 * 60 * 1000; // 4 分钟，低于 5 分钟超时阈
    const beatTimer = setInterval(() => {
      heartbeat.beat('core:otel');
      heartbeat.beat('trace-recording');
      heartbeat.beat('alert-bridge');
    }, HEARTBEAT_INTERVAL);
    if (typeof beatTimer.unref === 'function') beatTimer.unref();
  } catch (error) {
    await handleError(error, {
      module: 'core:otel',
      action: 'init',
    });
  }
}

/**
 * 启动 AITracePlugin（含失败模式防护）
 * 失败时不阻塞 OTel / Logger / Cost 等其他模块初始化
 */
async function startAITracePlugin(
  otelTracing: unknown,
  heartbeat: { register: (m: string, o?: { degraded?: boolean }) => void }
): Promise<void> {
  try {
    const { createAITracePlugin } = await import('../trace-recording/index.js');
    const { resolveDataSubDir } = await import('@modules/core/paths.js');

    const tracePlugin = createAITracePlugin({
      traceDir: resolveDataSubDir('traces'),
      deps: {
        otel: otelTracing,
        logger: new Logger({ module: 'trace-recording' }),
      },
    });
    heartbeat.register('trace-recording');
    logger.info('[MONITOR_HEARTBEAT] AITracePlugin started', {
      module: 'monitoring:boot',
    });
  } catch (err) {
    // 失败时输出心跳警告，不阻塞其余初始化
    logger.warn('[MONITOR_HEARTBEAT] AITracePlugin 启动失败，已跳过', {
      error: String(err),
      module: 'monitoring:boot',
    });
    heartbeat.register('trace-recording', { degraded: true });
  }
}
