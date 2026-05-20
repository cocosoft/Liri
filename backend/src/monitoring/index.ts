/**
 * 监控系统入口
 * 提供完整的监控功能导出
 */

// 核心监控服务
export {
  MonitoringService,
  getMonitoringService,
  getAndStartMonitoringService,
} from './MonitoringService.js';

export type { MonitoringConfig, SystemStatus } from './MonitoringService.js';

// 指标系统
export {
  MetricsService,
  MetricType,
  getMetricsService,
  createMetricsService,
} from './metrics/MetricsService.js';

export type {
  MetricConfig,
  CounterMetric,
  GaugeMetric,
  HistogramMetric,
  SummaryMetric,
} from './metrics/MetricsService.js';

// 日志系统
export { Logger, LogLevel, getLogger, createLogger } from './logs/Logger.js';

export type { LoggerConfig } from './logs/Logger.js';

// OpenTelemetry集成
export {
  PYAppDiagLogger,
  setupOtelDiagnostics,
  getDiagLogLevelFromEnv,
  OTelMetrics,
  getOTelMetrics,
  createOTelMetrics,
  OTelTracing,
  getOTelTracing,
  createOTelTracing,
  MetricsBridge,
  createMetricsBridge,
  TraceBridge,
  createTraceBridge,
  OTelLoggerAdapter,
} from './otel/index.js';

export type {
  OTelMetricsConfig,
  OTelTracingConfig,
  TraceWrapperOptions,
  MetricsBridgeConfig,
  MetricsBridgeStats,
  TraceEvent,
  TraceBridgeStats,
  OTelLoggerAdapterConfig,
} from './otel/index.js';

// 导出器
export {
  ConsoleExporter,
  getConsoleExporter,
  createConsoleExporter,
  FileExporter,
  getFileExporter,
  createFileExporter,
} from './exporters/index.js';

export type {
  ConsoleExporterConfig,
  ExportData,
  FileExporterConfig,
  FileExportData,
} from './exporters/index.js';

// 追踪系统
export {
  SessionTracing,
  getSessionTracing,
  createSessionTracing,
} from './tracing/index.js';

export type {
  SessionTracingConfig,
  SpanContext,
  SpanType,
} from './tracing/index.js';

// 告警系统
export {
  AlertManager,
  AlertLevel,
  getAlertManager,
  createAlertManager,
} from './alerts/index.js';

export type {
  AlertManagerConfig,
  AlertRule,
  AlertNotification,
  AlertHandler,
  AlertSilence,
} from './alerts/index.js';

// 系统集成
export {
  SystemMonitor,
  getSystemMonitor,
  createSystemMonitor,
} from './integration/index.js';

export type {
  SystemMonitorConfig,
  SystemInfo,
  ProcessInfo,
  DiskInfo,
} from './integration/index.js';

// 性能分析
export {
  PerformanceAnalyzer,
  getPerformanceAnalyzer,
  createPerformanceAnalyzer,
} from './performance/index.js';

export type {
  PerformanceMetrics,
  PerformanceSnapshot,
  PerformanceReport,
} from './performance/index.js';

// 健康检查
export { HealthChecker } from './health/index.js';
export type {
  HealthStatus,
  HealthCheck,
  HealthCheckResult,
  HealthCheckDefinition,
} from './health/index.js';

// 仪表盘数据
export { DashboardDataProvider } from './dashboard/index.js';
export type {
  DataPoint,
  TimeSeries,
  DashboardWidget,
  DashboardSnapshot,
  TimeRangeSummary,
} from './dashboard/index.js';

// 事件管理
export { IncidentManager, AlertIncidentBridge } from './incidents/index.js';
export type {
  Incident,
  IncidentFilter,
  IncidentStats,
  IncidentSeverity,
  IncidentStatus,
  AlertIncidentBridgeConfig,
  AlertIncidentBridgeStats,
} from './incidents/index.js';

// 仪器化
export {
  bootstrapTelemetry,
  parseExporterTypes,
  isTelemetryEnabled,
  initializeTelemetry,
  flushTelemetry,
} from './instrumentation.js';

// 备份管理
export { BackupManager, createDefaultBackupManager } from './backup/index.js';

export type {
  DatabaseEntry,
  BackupResult,
  RestoreResult,
  CleanupResult,
  BackupConfig,
} from './backup/index.js';

// 数据归档
export {
  DataArchivalStrategy,
  ArchiveDataType,
  DEFAULT_ARCHIVAL_CRON,
  ARCHIVAL_TASK_ID,
  executeArchivalMaintenance,
  setupArchivalScheduler,
  stopArchivalScheduler,
  registerArchivalCronTask,
  unregisterArchivalCronTask,
} from './archival/index.js';

export type {
  ArchiveMetadata,
  ArchiveFileInfo,
  ArchiveResult,
  CleanupResult as ArchiveCleanupResult,
  RetentionPolicies,
  ArchivalConfig,
  ArchivalMaintenanceResult,
  ArchivalSchedulerConfig,
} from './archival/index.js';
