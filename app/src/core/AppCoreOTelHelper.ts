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
 */

import { Logger } from '@modules/monitoring';

const logger = new Logger({ module: 'AppCore' });

/**
 * 初始化 OpenTelemetry 观测系统
 */
export async function initializeOTelSystem(): Promise<void> {
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
    const { createOTelLoggerAdapter } =
      await import('@modules/monitoring/otel/OTelLoggerAdapter.js');
    createOTelLoggerAdapter(otelTracing, {
      module: 'app',
      traceEnabled: true,
      jsonOutput: true,
    });
    logger.info('OTel 日志适配器已创建');
  } catch (error) {
    logger.error(
      'OTel 系统初始化失败',
      error instanceof Error ? error : new Error(String(error))
    );
  }
}
