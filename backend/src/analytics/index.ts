/**
 * 分析系统主入口
 */

export * from './AnalyticsManager.js';
export * from './DataCollector.js';
export * from './DataAnalyzer.js';
export * from './types.js';

export {
  AnalyticsService,
  analyticsService,
} from './AnalyticsService.js';

export {
  AnalyticsPersistenceService,
  DEFAULT_STORAGE_CONFIG,
} from './AnalyticsPersistenceService.js';

export {
  AnalyticsCategory,
  AnalyticsSeverity,
  createTypedEvent,
  getCategoryForEvent,
} from './AnalyticsSchema.js';

export type {
  StructuredAnalyticsEvent,
  QueryEvent,
  ToolEvent,
  TokenEvent,
  CostEvent,
  SessionEvent,
  ErrorEvent,
  PerformanceEvent,
  TypedAnalyticsEvent,
} from './AnalyticsSchema.js';

export {
  DashboardMetricsBuilder,
} from './DashboardMetrics.js';

export type {
  DashboardMetrics,
  SessionDashboardData,
  TokenDashboardData,
  CostDashboardData,
  ToolDashboardData,
  ErrorDashboardData,
  PerformanceDashboardData,
} from './DashboardMetrics.js';

export {
  PassesService,
  createPassesService,
  DEFAULT_PASSES,
} from './PassesService.js';

export type {
  PassType,
  PassDefinition,
  PassBalance,
} from './PassesService.js';

export {
  DatadogMetricsClient,
  getDatadogClient,
  DEFAULT_DATADOG_CONFIG,
} from './DatadogMetricsClient.js';

export type {
  DatadogConfig,
  DatadogMetric,
  DatadogEvent,
  DatadogServiceCheck,
} from './DatadogMetricsClient.js';

export {
  FirstPartyEventLogger,
  createFirstPartyEventLogger,
} from './FirstPartyEventLogger.js';

export type {
  FirstPartyEventSchema,
  FirstPartyEventSink,
} from './FirstPartyEventLogger.js';

export {
  OpenTelemetryTracer,
  createTracer,
} from './OpenTelemetryTracer.js';

export type {
  SpanContext,
  TracerConfig,
} from './OpenTelemetryTracer.js';

export {
  CostTrackerPassesHook,
  createCostTrackerPassesHook,
} from './CostTrackerPassesHook.js';

export type {
  CostCheckResult,
} from './CostTrackerPassesHook.js';

export {
  AnonymizationPipeline,
  createAnonymizationPipeline,
  PII_PATTERNS,
} from './AnonymizationService.js';

export type {
  AnonymizationResult,
  PIIMatch,
  AnonymizationOptions,
} from './AnonymizationService.js';

import { analyticsService } from './AnalyticsService.js';

export function logEvent(
  eventName: string,
  metadata: Record<string, boolean | number | string | undefined> = {}
): void {
  analyticsService.logEvent(eventName, metadata);
}

// 导出分析报告类型
export type { AnalyticsReport } from './AnalyticsManager.js';
export type { EventStats } from './DataCollector.js';
export type {
  EventAnalysis,
  SessionAnalysis,
  TimeDistribution,
  MetadataPatterns,
  CorrelationAnalysis,
  AnomalyDetection,
  TrendAnalysis,
  SessionDurationAnalysis,
  TokenUsageAnalysis,
  CostAnalysis,
  ErrorRateAnalysis,
  ToolUsageAnalysis,
} from './DataAnalyzer.js';