// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.
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
export {
  getSystemCpuPercentAsync,
  getDiskInfoAsync,
  getProcessCpuPercent,
  getSystemCpuPercent,
  getProcessMemory,
  getSystemMemory,
  getDiskInfo,
  collectAllMetrics,
  resetCpuState,
} from './metrics/SystemMetricsCollector.js';
export type {
  ProcessMemory,
  SystemMemory,
  DiskInfo,
  SystemMetrics,
} from './metrics/SystemMetricsCollector.js';

export type {
  MetricConfig,
  CounterMetric,
  GaugeMetric,
  HistogramMetric,
  SummaryMetric,
} from './metrics/MetricsService.js';

// 日志系统
export {
  Logger,
  LogLevel,
  getLogger,
  createLogger,
  setGlobalConfigProvider,
  setGlobalBufferConfig,
  flush,
} from './logs/Logger.js';

export type { LoggerConfig } from './logs/Logger.js';

export { StructuredLogger } from './logs/StructuredLogger.js';
export type { StructuredLogEntry } from './logs/LogMemory.js';

export { logConfigManager, LogConfigManager } from './logs/config/LogConfig.js';
export type { LogTarget, LogConfiguration } from './logs/config/LogConfig.js';

export { logRedact, LogRedact } from './logs/redact/LogRedact.js';
export type {
  RedactPattern,
  LogRedactConfig,
} from './logs/redact/LogRedact.js';

export { logFilter, LogFilter } from './logs/filter/LogFilter.js';
export type { FilterRule, LogFilterConfig } from './logs/filter/LogFilter.js';

export {
  logDiagnostic,
  LogDiagnostic,
} from './logs/diagnostic/LogDiagnostic.js';
export type {
  DiagnosticConfig,
  DiagnosticCheck,
  DiagnosticResult,
} from './logs/diagnostic/LogDiagnostic.js';

export { LogTail } from './logs/tail/LogTail.js';
export type { TailOptions, LogLine } from './logs/tail/LogTail.js';

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
  getOTelLoggerAdapter,
  createOTelLoggerAdapter,
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
} from './integration/index.js';

// 集成层 DiskInfo（注意与 metrics/DiskInfo 重名，使用时小心混淆）
export type { DiskInfo as IntegrationDiskInfo } from './integration/index.js';

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

// 监控心跳
export { HeartbeatMonitor } from './HeartbeatMonitor.js';
export type { HeartbeatEntry } from './HeartbeatMonitor.js';

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

// LLM 跟踪模块
export { LLMTracker } from './llm/LLMTracker.js';
export type {
  LLMCallRecord,
  SessionLLMStats,
  SessionSummary,
  SessionDetail,
} from './llm/LLMTracker.js';
