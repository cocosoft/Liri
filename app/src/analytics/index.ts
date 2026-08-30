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
 * 分析系统主入口
 */

export * from './AnalyticsManager.js';
export * from './DataCollector.js';
export * from './DataAnalyzer.js';
export * from './types.js';

export { AnalyticsService, analyticsService } from './AnalyticsService.js';

export {
  AnalyticsPersistenceService,
  getDefaultStorageConfig,
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

export { DashboardMetricsBuilder } from './DashboardMetrics.js';

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

export type { PassType, PassDefinition, PassBalance } from './PassesService.js';

export {
  DatadogMetricsClient,
  getDatadogClient,
  getDefaultDatadogConfig,
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
  CostTrackerPassesHook,
  createCostTrackerPassesHook,
} from './CostTrackerPassesHook.js';

export type { CostCheckResult } from './CostTrackerPassesHook.js';

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

export { InsightsEngine, insightsEngine } from './InsightsEngine.js';
export type {
  ConversationMessage,
  InsightsResult,
  InsightsEngineConfig,
} from './InsightsEngine.js';
