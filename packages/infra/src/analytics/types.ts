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
 * Analytics事件类型定义
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
