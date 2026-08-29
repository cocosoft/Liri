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

/* eslint-disable @typescript-eslint/no-explicit-any -- legacy code with dynamic types */

/**
 * analytics-handlers.ts — 分析面板、成本统计、健康报告处理器（从 LocalHTTPService 提取）
 */

import type http from 'http';
import type { HandlerCtx } from './handler-utils';
import { getLogger } from '@modules/monitoring';
import { getMonitoringService } from '@modules/monitoring';
import { handleError } from '@modules/error';

const logger = getLogger('infrastructure:http:handlers:analytics-handlers');

// ── 依赖注入（由 LocalHTTPService 在构造时注入） ─────────────────

let analyticsService: {
  getEvents(): unknown[];
  getStats(): {
    totalEvents: number;
    totalSessions: number;
    activeSessions: number;
  };
  getToolCallStats(): {
    totalCalls: number;
    uniqueTools: number;
    topTools: Array<{ name: string; count: number }>;
  };
} | null = null;

let costTracker: {
  getTotalCostUSD(): number;
  getTotalInputTokens(): number;
  getTotalOutputTokens(): number;
  getModelUsage(): Record<
    string,
    {
      inputTokens: number;
      outputTokens: number;
      costUSD: number;
      cacheReadInputTokens: number;
      cacheCreationInputTokens: number;
      requestCount: number;
    }
  >;
} | null = null;

let costRepository: {
  initDatabase(): Promise<void>;
  getAggregatedCosts(opts: { startTime?: number }): Promise<{
    totalCostUSD: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    totalRequests: number;
  }>;
  getCostRecords(opts: {
    startTime?: number;
    endTime?: number;
    limit?: number;
    offset?: number;
  }): Promise<
    Array<{
      id: string;
      timestamp: number;
      model: string;
      inputTokens: number;
      outputTokens: number;
      costUSD: number;
      cacheReadTokens: number;
      cacheCreationTokens: number;
    }>
  >;
} | null = null;

let performanceMonitorService: {
  getInstance(): { getAllMetrics(): Array<{ duration: number }> };
} | null = null;

export function setAnalyticsDependencies(
  analytics: typeof analyticsService,
  cost: typeof costTracker,
  costRepo: typeof costRepository,
  perfSvc: typeof performanceMonitorService
): void {
  analyticsService = analytics;
  costTracker = cost;
  costRepository = costRepo;
  performanceMonitorService = perfSvc;
}

// ── 日期计算 ──────────────────────────────────────────────────────

function getStartOfToday(): number {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
}

// ── 辅助函数 ──────────────────────────────────────────────────────

async function ensureCostRepository(): Promise<void> {
  try {
    await costRepository?.initDatabase();
  } catch (err) {
    void handleError(err, {
      module: 'infrastructure:http:analytics',
      action: 'initCostRepository',
    });
  }
}

function calcPercentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return (
    Math.round(sorted[Math.max(0, Math.min(idx, sorted.length - 1))] * 100) /
    100
  );
}

// ── 处理器 ────────────────────────────────────────────────────────

/**
 * GET /v1/health/report — 健康报告
 */
export async function handleHealthReport(
  _ctx: HandlerCtx,
  _req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const service = getMonitoringService();
    const status = service.getSystemStatus();
    const components = [
      {
        name: 'system',
        status: (status.uptime > 0 ? 'ok' : 'warning') as
          | 'ok'
          | 'warning'
          | 'error',
      },
      {
        name: 'memory',
        status: (status.memory.heapUsed < status.memory.heapTotal * 0.9
          ? 'ok'
          : 'warning') as 'ok' | 'warning' | 'error',
      },
    ];
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(
      JSON.stringify({
        status: components.every((c) => c.status === 'ok')
          ? 'healthy'
          : 'degraded',
        components,
        timestamp: Date.now(),
      })
    );
  } catch (_err) {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(
      JSON.stringify({
        status: 'healthy',
        components: [],
        timestamp: Date.now(),
      })
    );
  }
}

/**
 * GET /v1/analytics/dashboard — 分析面板
 */
export async function handleAnalyticsDashboard(
  _ctx: HandlerCtx,
  _req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    if (!analyticsService || !costTracker) {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({}));
      return;
    }

    const events = analyticsService!.getEvents();
    const stats = analyticsService!.getStats();

    const toolEvents = events.filter((e: any) =>
      ['tool_call', 'tool_execute', 'tool_result'].includes(e.type)
    );
    const errorEvents = events.filter((e: any) =>
      ['error', 'api_error'].includes(e.type)
    );
    const perfEvents = events.filter((e: any) => e.type === 'performance');
    const llmEvents = events.filter((e: any) =>
      [
        'llm_request',
        'api_call',
        'api_retry',
        'query_start',
        'query_complete',
      ].includes(e.type)
    );

    // 工具调用统计
    const toolCounts = new Map<string, number>();
    for (const e of toolEvents) {
      const evt = e as Record<string, unknown>;
      // 埋点统一写 metadata.tool_name（ToolExecutor/ToolRegistry/QueryEngine 三处一致）；
      // 早期可能混用 toolName，故两者都读
      const name =
        ((evt.metadata as Record<string, unknown>)?.tool_name as string) ||
        ((evt.metadata as Record<string, unknown>)?.toolName as string) ||
        (evt.name as string) ||
        'unknown';
      toolCounts.set(name, (toolCounts.get(name) || 0) + 1);
    }
    const topTools = Array.from(toolCounts.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    // 错误统计
    const errorTypeCounts = new Map<string, number>();
    for (const e of errorEvents) {
      const evt = e as Record<string, unknown>;
      const errType =
        ((evt.metadata as Record<string, unknown>)?.errorType as string) ||
        (evt.name as string) ||
        'unknown';
      errorTypeCounts.set(errType, (errorTypeCounts.get(errType) || 0) + 1);
    }
    const topErrors = Array.from(errorTypeCounts.entries())
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    // 延迟数据
    const latencies = perfEvents
      .map((e: any) => e.metadata?.metricValue)
      .filter((v: any) => typeof v === 'number' && v > 0)
      .sort((a: number, b: number) => a - b);

    if (performanceMonitorService) {
      const perfService = performanceMonitorService.getInstance();
      const allPerfMetrics = perfService.getAllMetrics();
      const perfDurations = allPerfMetrics
        .map((m) => m.duration)
        .filter((d) => d > 0)
        .sort((a, b) => a - b);
      if (perfDurations.length > 0) {
        latencies.push(...perfDurations);
        latencies.sort((a, b) => a - b);
      }
    }

    // Token 用量（来自 costTracker，即使 events 为空也有数据）
    const modelUsage = costTracker!.getModelUsage();
    let totalInputTokens = 0,
      totalOutputTokens = 0,
      totalCostUSD = 0,
      totalRequests = 0;
    for (const usage of Object.values(modelUsage)) {
      totalInputTokens += usage.inputTokens;
      totalOutputTokens += usage.outputTokens;
      totalCostUSD += usage.costUSD;
      totalRequests += usage.requestCount || 0;
    }

    // 当 costTracker 无数据时，从 costRepository DB 查询回退
    if (totalRequests === 0 && costRepository) {
      try {
        await ensureCostRepository();
        const todayStart = getStartOfToday();
        const dbResult = await costRepository.getAggregatedCosts({
          startTime: todayStart,
        });
        if (dbResult.totalRequests > 0) {
          totalInputTokens = dbResult.totalInputTokens;
          totalOutputTokens = dbResult.totalOutputTokens;
          totalCostUSD = dbResult.totalCostUSD;
          totalRequests = dbResult.totalRequests;
          logger.info('分析面板 Token/成本数据从 costRepository DB 回退', {
            totalRequests,
            totalCostUSD,
          });
        }
      } catch (err) {
        void handleError(err, {
          module: 'infrastructure:http:analytics',
          action: 'fallbackCostDB',
        });
      }
    }

    // 工具调用统计：优先持久化 query_logs（重启不清零），回退内存累计器
    let persistedToolStats: Awaited<
      ReturnType<
        import('@modules/query/QueryLogStore').QueryLogStore['getToolStats']
      >
    > | null = null;
    try {
      const { getQueryLogStore } = await import('@modules/query/QueryLogStore');
      persistedToolStats = await getQueryLogStore().getToolStats();
    } catch (err) {
      // 查询日志不可用时回退内存统计
      void handleError(err, {
        module: 'infrastructure:http:analytics',
        action: 'loadPersistedToolStats',
      });
    }
    // 使用独立累计器作为工具调用数据的回退（不受事件队列清空影响）
    const toolCallStats = analyticsService!.getToolCallStats();

    // 错误统计：优先持久化 query_logs（重启不清零），回退内存事件
    let persistedErrorStats: Awaited<
      ReturnType<
        import('@modules/query/QueryLogStore').QueryLogStore['getErrorStats']
      >
    > | null = null;
    try {
      const { getQueryLogStore } = await import('@modules/query/QueryLogStore');
      persistedErrorStats = await getQueryLogStore().getErrorStats();
    } catch (err) {
      void handleError(err, {
        module: 'infrastructure:http:analytics',
        action: 'loadPersistedErrorStats',
      });
    }

    // 延迟百分位：优先持久化 model_usage_logs.latency_ms（重启不清零），回退内存
    let persistedLatencyStats: Awaited<
      ReturnType<import('@modules/ai').UsageStatsService['getLatencyStats']>
    > | null = null;
    try {
      const { usageStatsService } = await import('@modules/ai');
      await usageStatsService.initialize();
      persistedLatencyStats = await usageStatsService.getLatencyStats();
    } catch (err) {
      void handleError(err, {
        module: 'infrastructure:http:analytics',
        action: 'loadPersistedLatencyStats',
      });
    }

    // 会话统计：优先持久化 session_cost_summaries（重启不清零），回退内存
    let persistedSessionCount: { total: number; active: number } | null = null;
    try {
      const { getCostRecordRepository } = await import('@modules/cost');
      const repo = getCostRecordRepository();
      persistedSessionCount = {
        total: await repo.countSessionSummaries(),
        active: await repo.countActiveSessionSummaries(),
      };
    } catch (err) {
      void handleError(err, {
        module: 'infrastructure:http:analytics',
        action: 'loadPersistedSessionCount',
      });
    }

    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(
      JSON.stringify({
        tokens: {
          totalInputTokens,
          totalOutputTokens,
          totalTokens: totalInputTokens + totalOutputTokens,
          totalLLMRequests:
            llmEvents.length > 0 ? llmEvents.length : totalRequests,
        },
        tools: {
          totalToolCalls:
            persistedToolStats && persistedToolStats.totalToolCalls > 0
              ? persistedToolStats.totalToolCalls
              : toolEvents.length > 0
                ? toolEvents.length
                : toolCallStats.totalCalls,
          uniqueToolsUsed:
            persistedToolStats && persistedToolStats.uniqueToolsUsed > 0
              ? persistedToolStats.uniqueToolsUsed
              : toolEvents.length > 0
                ? toolCounts.size
                : toolCallStats.uniqueTools,
          topTools:
            persistedToolStats && persistedToolStats.topTools.length > 0
              ? persistedToolStats.topTools
              : toolEvents.length > 0
                ? topTools
                : toolCallStats.topTools,
        },
        errors: {
          totalErrors:
            persistedErrorStats && persistedErrorStats.totalCalls > 0
              ? persistedErrorStats.totalErrors
              : errorEvents.length,
          errorRate:
            persistedErrorStats && persistedErrorStats.totalCalls > 0
              ? persistedErrorStats.errorRate
              : events.length > 0
                ? Math.round((errorEvents.length / events.length) * 10000) / 100
                : 0,
          topErrors:
            persistedErrorStats && persistedErrorStats.topErrors.length > 0
              ? persistedErrorStats.topErrors
              : topErrors,
        },
        performance: {
          averageLatencyMs:
            persistedLatencyStats && persistedLatencyStats.sampleCount > 0
              ? persistedLatencyStats.averageLatencyMs
              : latencies.length > 0
                ? Math.round(
                    (latencies.reduce((a, b) => a + b, 0) / latencies.length) *
                      100
                  ) / 100
                : 0,
          p50LatencyMs:
            persistedLatencyStats && persistedLatencyStats.sampleCount > 0
              ? persistedLatencyStats.p50LatencyMs
              : calcPercentile(latencies, 50),
          p95LatencyMs:
            persistedLatencyStats && persistedLatencyStats.sampleCount > 0
              ? persistedLatencyStats.p95LatencyMs
              : calcPercentile(latencies, 95),
          p99LatencyMs:
            persistedLatencyStats && persistedLatencyStats.sampleCount > 0
              ? persistedLatencyStats.p99LatencyMs
              : calcPercentile(latencies, 99),
          totalMetrics:
            persistedLatencyStats && persistedLatencyStats.sampleCount > 0
              ? persistedLatencyStats.sampleCount
              : latencies.length,
        },
        cost: { totalCostUSD: Math.round(totalCostUSD * 10000) / 10000 },
        session: {
          totalEvents: stats.totalEvents,
          totalSessions:
            persistedSessionCount && persistedSessionCount.total > 0
              ? persistedSessionCount.total
              : stats.totalSessions,
          activeSessions:
            persistedSessionCount && persistedSessionCount.total > 0
              ? persistedSessionCount.active
              : stats.activeSessions,
        },
        generatedAt: Date.now(),
      })
    );
  } catch (_err) {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(
      JSON.stringify({
        tokens: {
          totalInputTokens: 0,
          totalOutputTokens: 0,
          totalTokens: 0,
          totalLLMRequests: 0,
        },
        tools: { totalToolCalls: 0, uniqueToolsUsed: 0, topTools: [] },
        errors: { totalErrors: 0, errorRate: 0, topErrors: [] },
        performance: {
          averageLatencyMs: 0,
          p50LatencyMs: 0,
          p95LatencyMs: 0,
          p99LatencyMs: 0,
          totalMetrics: 0,
        },
        cost: { totalCostUSD: 0 },
        session: { totalEvents: 0, totalSessions: 0, activeSessions: 0 },
        generatedAt: Date.now(),
      })
    );
  }
}
