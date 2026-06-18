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

import type http from 'node:http';
import type { HandlerCtx } from './handler-utils';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import { getMonitoringService } from '@modules/monitoring/MonitoringService';

const logger = new Logger({ level: LogLevel.INFO });

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

function getStartOfWeek(): number {
  const now = new Date();
  const day = now.getDay();
  const diff = now.getDate() - day + (day === 0 ? -6 : 1);
  return new Date(now.getFullYear(), now.getMonth(), diff).getTime();
}

function getStartOfMonth(): number {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1).getTime();
}

function getStartOfYear(): number {
  const now = new Date();
  return new Date(now.getFullYear(), 0, 1).getTime();
}

// ── 辅助函数 ──────────────────────────────────────────────────────

async function ensureCostRepository(): Promise<void> {
  try {
    await costRepository?.initDatabase();
  } catch (err) {
    logger.warning('成本仓库初始化失败', { error: String(err) });
  }
}

async function queryAggregatedCost(
  startTime: number
): Promise<{ cost: number; tokens: number }> {
  try {
    const result = await costRepository!.getAggregatedCosts({ startTime });
    return {
      cost: result.totalCostUSD,
      tokens: result.totalInputTokens + result.totalOutputTokens,
    };
  } catch (err) {
    logger.warning('查询聚合成本失败', {
      startTime: new Date(startTime).toISOString(),
      error: String(err),
    });
    return { cost: 0, tokens: 0 };
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
  } catch {
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
      const name =
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
        logger.warning('分析面板 costRepository DB 回退失败', {
          error: String(err),
        });
      }
    }

    // 使用独立累计器作为工具调用数据的回退（不受事件队列清空影响）
    const toolCallStats = analyticsService!.getToolCallStats();

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
            toolEvents.length > 0
              ? toolEvents.length
              : toolCallStats.totalCalls,
          uniqueToolsUsed:
            toolEvents.length > 0 ? toolCounts.size : toolCallStats.uniqueTools,
          topTools: toolEvents.length > 0 ? topTools : toolCallStats.topTools,
        },
        errors: {
          totalErrors: errorEvents.length,
          errorRate:
            events.length > 0
              ? Math.round((errorEvents.length / events.length) * 10000) / 100
              : 0,
          topErrors,
        },
        performance: {
          averageLatencyMs:
            latencies.length > 0
              ? Math.round(
                  (latencies.reduce((a, b) => a + b, 0) / latencies.length) *
                    100
                ) / 100
              : 0,
          p50LatencyMs: calcPercentile(latencies, 50),
          p95LatencyMs: calcPercentile(latencies, 95),
          p99LatencyMs: calcPercentile(latencies, 99),
          totalMetrics: latencies.length,
        },
        cost: { totalCostUSD: Math.round(totalCostUSD * 10000) / 10000 },
        session: {
          totalEvents: stats.totalEvents,
          totalSessions: stats.totalSessions,
          activeSessions: stats.activeSessions,
        },
        generatedAt: Date.now(),
      })
    );
  } catch {
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

/**
 * GET /api/cost/summary — 成本摘要
 */
export async function handleCostSummary(
  _ctx: HandlerCtx,
  _req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  await ensureCostRepository();

  const todayStart = getStartOfToday();
  const weekStart = getStartOfWeek();
  const monthStart = getStartOfMonth();
  const yearStart = getStartOfYear();

  const [today, weekly, monthly, yearly] = await Promise.all([
    queryAggregatedCost(todayStart),
    queryAggregatedCost(weekStart),
    queryAggregatedCost(monthStart),
    queryAggregatedCost(yearStart),
  ]);

  const modelUsage = costTracker!.getModelUsage();
  const totalModelCost = Object.values(modelUsage).reduce(
    (sum, u) => sum + u.costUSD,
    0
  );

  // 日志：排出实际值用于调试
  logger.info('handleCostSummary 数据', {
    todayCost: today.cost,
    todayTokens: today.tokens,
    totalModelCost,
    modelCount: Object.keys(modelUsage).length,
  });
  const topProviders = Object.entries(modelUsage)
    .map(([provider, usage]) => ({
      provider,
      cost: usage.costUSD,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      totalTokens: usage.inputTokens + usage.outputTokens,
      cacheReadTokens: usage.cacheReadInputTokens,
      cacheCreationTokens: usage.cacheCreationInputTokens,
      requests: usage.requestCount,
      percentage:
        totalModelCost > 0
          ? Math.round((usage.costUSD / totalModelCost) * 100)
          : 0,
    }))
    .sort((a, b) => b.cost - a.cost)
    .slice(0, 8);

  // 每日明细
  const dailyBreakdown: { date: string; cost: number; tokens: number }[] = [];
  try {
    const recentRecords = await costRepository!.getCostRecords({
      startTime: weekStart,
    });
    const dayMap = new Map<string, { cost: number; tokens: number }>();
    for (const record of recentRecords) {
      const dateStr = new Date(record.timestamp).toISOString().slice(5, 10);
      const entry = dayMap.get(dateStr) || { cost: 0, tokens: 0 };
      entry.cost += record.costUSD;
      entry.tokens += record.inputTokens + record.outputTokens;
      dayMap.set(dateStr, entry);
    }
    for (const [date, data] of dayMap.entries()) {
      dailyBreakdown.push({ date, cost: data.cost, tokens: data.tokens });
    }
    dailyBreakdown.sort((a, b) => a.date.localeCompare(b.date));
  } catch {
    /* 每日明细不可用时不返回 */
  }

  const sessionState = {
    totalCostUSD: costTracker!.getTotalCostUSD(),
    totalInputTokens: costTracker!.getTotalInputTokens(),
    totalOutputTokens: costTracker!.getTotalOutputTokens(),
  };

  // 运行时回退：DB 查询返回 0 但 CostTracker 有数据时，以运行时为准
  const effectiveTodayCost =
    today.cost > 0 ? today.cost : sessionState.totalCostUSD;
  const effectiveTodayTokens =
    today.tokens > 0
      ? today.tokens
      : sessionState.totalInputTokens + sessionState.totalOutputTokens;
  if (today.cost === 0 && sessionState.totalCostUSD > 0) {
    logger.info('今日成本回退到运行时数据', {
      dbCost: today.cost,
      runtimeCost: sessionState.totalCostUSD,
    });
  }

  const totalInputTokens = Object.values(modelUsage).reduce(
    (sum, u) => sum + u.inputTokens,
    0
  );
  const totalOutputTokens = Object.values(modelUsage).reduce(
    (sum, u) => sum + u.outputTokens,
    0
  );
  const totalCacheRead = Object.values(modelUsage).reduce(
    (sum, u) => sum + u.cacheReadInputTokens,
    0
  );
  const totalCacheCreation = Object.values(modelUsage).reduce(
    (sum, u) => sum + u.cacheCreationInputTokens,
    0
  );

  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(
    JSON.stringify({
      todayCost: effectiveTodayCost,
      weeklyCost: weekly.cost,
      monthlyCost: monthly.cost,
      yearlyCost: yearly.cost,
      totalSessions: 0, // cost_records 不直接跟踪会话，后续可通过 ChatManager 注入
      todayTokens: effectiveTodayTokens,
      monthlyTokens: monthly.tokens,
      totalInputTokens,
      totalOutputTokens,
      totalTokens: totalInputTokens + totalOutputTokens,
      totalCacheReadTokens: totalCacheRead,
      totalCacheCreationTokens: totalCacheCreation,
      totalRequests: Object.keys(modelUsage).length,
      sessionCost: sessionState.totalCostUSD,
      sessionInputTokens: sessionState.totalInputTokens,
      sessionOutputTokens: sessionState.totalOutputTokens,
      sessionTokens:
        sessionState.totalInputTokens + sessionState.totalOutputTokens,
      topProviders,
      dailyBreakdown,
    })
  );
}

/**
 * GET /api/cost/records — 成本记录列表
 */
export async function handleCostRecords(
  _ctx: HandlerCtx,
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  await ensureCostRepository();
  const urlObj = new URL(req.url!, `http://${req.headers.host}`);
  const page = parseInt(urlObj.searchParams.get('page') || '1', 10);
  const limit = parseInt(urlObj.searchParams.get('limit') || '20', 10);
  const offset = (page - 1) * limit;

  try {
    const records = await costRepository!.getCostRecords({ limit, offset });
    const totalResult = await costRepository!.getAggregatedCosts({});
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(
      JSON.stringify({
        records: records.map((r) => ({
          id: r.id,
          date: new Date(r.timestamp)
            .toISOString()
            .replace('T', ' ')
            .slice(0, 19),
          provider: r.model,
          model: r.model,
          promptTokens: r.inputTokens,
          completionTokens: r.outputTokens,
          totalTokens: r.inputTokens + r.outputTokens,
          cacheReadTokens: r.cacheReadTokens,
          cacheCreationTokens: r.cacheCreationTokens,
          cost: r.costUSD,
          currency: 'USD',
        })),
        total: totalResult.totalRequests,
      })
    );
  } catch {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ records: [], total: 0 }));
  }
}

/**
 * GET /api/cost/range — 按日期范围查询成本
 */
export async function handleCostRange(
  _ctx: HandlerCtx,
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  await ensureCostRepository();
  const urlObj = new URL(req.url!, `http://${req.headers.host}`);
  const startTime = urlObj.searchParams.get('startDate')
    ? new Date(urlObj.searchParams.get('startDate')!).getTime()
    : undefined;
  const endTime = urlObj.searchParams.get('endDate')
    ? new Date(urlObj.searchParams.get('endDate')!).getTime()
    : undefined;

  try {
    const records = await costRepository!.getCostRecords({
      startTime,
      endTime,
    });
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(
      JSON.stringify(
        records.map((r) => ({
          id: r.id,
          date: new Date(r.timestamp)
            .toISOString()
            .replace('T', ' ')
            .slice(0, 19),
          provider: r.model,
          model: r.model,
          promptTokens: r.inputTokens,
          completionTokens: r.outputTokens,
          totalTokens: r.inputTokens + r.outputTokens,
          cost: r.costUSD,
          currency: 'USD',
        }))
      )
    );
  } catch {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify([]));
  }
}
