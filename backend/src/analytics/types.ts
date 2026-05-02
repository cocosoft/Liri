/**
 * Analytics事件类型定义
 * 基于CC源码 cc_code/backend/services/analytics/ 实现
 */

export type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS = never;

export type AnalyticsMetadata_I_VERIFIED_THIS_IS_PII_TAGGED = never;

export interface AnalyticsEvent {
  eventName: string;
  metadata: Record<string, boolean | number | string | undefined>;
  timestamp: number;
  async: boolean;
}

export interface AnalyticsSink {
  logEvent(
    eventName: string,
    metadata: Record<string, boolean | number | string | undefined>
  ): void;
  logEventAsync(
    eventName: string,
    metadata: Record<string, boolean | number | string | undefined>
  ): Promise<void>;
}

export interface EventMetrics {
  totalEvents: number;
  eventsByType: Map<string, number>;
  eventsBySource: Map<string, number>;
  lastEventTime?: number;
}

export interface SessionAnalytics {
  sessionId: string;
  startTime: number;
  endTime?: number;
  events: AnalyticsEvent[];
  tokenUsage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  costUSD: number;
  toolCalls: number;
  errors: number;
}
