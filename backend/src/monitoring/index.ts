/**
 * 监控系统入口
 * 提供完整的监控功能导出
 */

// 核心监控服务
export {
  MonitoringService,
  MonitoringConfig,
  SystemStatus,
  getMonitoringService,
  getAndStartMonitoringService,
} from './MonitoringService.js';

// 指标系统
export {
  MetricsService,
  MetricType,
  MetricConfig,
  CounterMetric,
  GaugeMetric,
  HistogramMetric,
  SummaryMetric,
  getMetricsService,
  createMetricsService,
} from './metrics/MetricsService.js';

// 日志系统
export {
  Logger,
  LogLevel,
  LoggerConfig,
  getLogger,
  createLogger,
} from './logs/Logger.js';

// OpenTelemetry集成
export {
  PYAppDiagLogger,
  setupOtelDiagnostics,
  getDiagLogLevelFromEnv,
  OTelMetrics,
  OTelMetricsConfig,
  getOTelMetrics,
  createOTelMetrics,
  OTelTracing,
  OTelTracingConfig,
  TraceWrapperOptions,
  getOTelTracing,
  createOTelTracing,
} from './otel/index.js';

// 导出器
export {
  ConsoleExporter,
  ConsoleExporterConfig,
  ExportData,
  getConsoleExporter,
  createConsoleExporter,
  FileExporter,
  FileExporterConfig,
  FileExportData,
  getFileExporter,
  createFileExporter,
} from './exporters/index.js';

// 追踪系统
export {
  SessionTracing,
  SessionTracingConfig,
  SpanType,
  SpanContext,
  getSessionTracing,
  createSessionTracing,
} from './tracing/index.js';

// 告警系统
export {
  AlertManager,
  AlertManagerConfig,
  AlertRule,
  AlertNotification,
  AlertHandler,
  AlertLevel,
  getAlertManager,
  createAlertManager,
} from './alerts/index.js';

// 系统集成
export {
  SystemMonitor,
  SystemMonitorConfig,
  SystemInfo,
  ProcessInfo,
  DiskInfo,
  getSystemMonitor,
  createSystemMonitor,
} from './integration/index.js';

// 性能分析
export {
  PerformanceAnalyzer,
  PerformanceMetrics,
  PerformanceSnapshot,
  PerformanceReport,
  getPerformanceAnalyzer,
  createPerformanceAnalyzer,
} from './performance/index.js';

// 健康检查
export {
  HealthChecker,
} from './health/index.js';
export type {
  HealthStatus,
  HealthCheck,
  HealthCheckResult,
  HealthCheckDefinition,
} from './health/index.js';

// 仪表盘数据
export {
  DashboardDataProvider,
} from './dashboard/index.js';
export type {
  DataPoint,
  TimeSeries,
  DashboardWidget,
  DashboardSnapshot,
  TimeRangeSummary,
} from './dashboard/index.js';

// 事件管理
export {
  IncidentManager,
} from './incidents/index.js';
export type {
  Incident,
  IncidentFilter,
  IncidentStats,
  IncidentSeverity,
  IncidentStatus,
} from './incidents/index.js';

// 仪器化
export {
  bootstrapTelemetry,
  parseExporterTypes,
  isTelemetryEnabled,
  initializeTelemetry,
  flushTelemetry,
} from './instrumentation.js';
