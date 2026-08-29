/**
 * 对话式成本感知 API Handler
 *
 * 集成现有 CostTracker 和 CostBudgetManager，提供工作空间成本查询：
 * - GET /v1/workspaces/:id/cost/report  — 成本报告
 * - GET /v1/workspaces/:id/cost/budget  — 预算状态
 */

import type http from 'http';
import type { HandlerCtx } from './handler-utils';
import { handleError } from '@modules/error';
import { getLogger } from '@modules/monitoring';
import { resolveWorkspacePath } from './workspaces-handlers';
import type { CostReport } from '@modules/workspace/types';

const logger = getLogger('http:cost');

/**
 * 获取成本报告
 * GET /v1/workspaces/:id/cost/report
 *
 * 整合现有 costTracker 和 costBudgetManager 数据
 */
export async function handleWorkspaceCostReport(
  ctx: HandlerCtx,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  workspaceId: string
): Promise<void> {
  try {
    const wsPath = await resolveWorkspacePath(workspaceId);
    if (!wsPath) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Workspace not found' } }));
      return;
    }

    // 从现有 costTracker 获取成本数据
    let totalCostUSD = 0;
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    const modelBreakdown: Record<
      string,
      { model: string; costUSD: number; tokens: number; requestCount: number }
    > = {};

    try {
      const { costTracker } = await import('@modules/cost/CostTracker');
      totalCostUSD = costTracker.getTotalCostUSD();
      totalInputTokens = costTracker.getTotalInputTokens();
      totalOutputTokens = costTracker.getTotalOutputTokens();

      const modelUsage = costTracker.getModelUsage();
      // modelUsage is Record<string, ModelUsage>, iterate with Object.entries
      for (const [model, usage] of Object.entries(modelUsage)) {
        modelBreakdown[model] = {
          model,
          costUSD: usage.costUSD,
          tokens: (usage.inputTokens || 0) + (usage.outputTokens || 0),
          requestCount: 0,
        };
      }
    } catch (_err) {
      logger.warn('costTracker 不可用，返回空报告');
    }

    // 从 costBudgetManager 获取预算状态
    let budgetStatus: 'ok' | 'warning' | 'exceeded' = 'ok';
    let budgetUtilization = 0;

    try {
      const { costBudgetManager } =
        await import('@modules/cost/CostBudgetManager');
      const statuses = costBudgetManager.getAllBudgetStatuses();
      if (statuses.length > 0) {
        // 使用第一个启用的预算状态
        const monthlyStatus = statuses.find(
          (s: { budgetId: string }) => s.budgetId === 'monthly-budget'
        );
        const primary = monthlyStatus || statuses[0];
        if (primary.status === 'exceeded') {
          budgetStatus = 'exceeded';
        } else if (primary.status === 'warning') {
          budgetStatus = 'warning';
        }
        budgetUtilization = primary.percentageUsed / 100;
      }
    } catch (_err) {
      // budgetManager 可能未配置
    }

    const report: CostReport = {
      id: `cost_${Date.now()}`,
      workspaceId,
      totalCostUSD,
      totalTokens: totalInputTokens + totalOutputTokens,
      inputTokens: totalInputTokens,
      outputTokens: totalOutputTokens,
      modelBreakdown,
      budgetStatus,
      budgetUtilization,
      generatedAt: new Date().toISOString(),
      period: 'total',
    };

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(report));
  } catch (err) {
    await handleError(err, { module: 'infra:http', action: 'cost_report' });
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({ error: { message: 'Failed to get cost report' } })
      );
    }
  }
}

/**
 * 获取预算状态
 * GET /v1/workspaces/:id/cost/budget
 */
export async function handleWorkspaceBudgetStatus(
  ctx: HandlerCtx,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  workspaceId: string
): Promise<void> {
  try {
    const wsPath = await resolveWorkspacePath(workspaceId);
    if (!wsPath) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Workspace not found' } }));
      return;
    }

    let budgetInfo: {
      status: 'ok' | 'warning' | 'exceeded';
      currentCost: number;
      limit: number;
      remaining: number;
      percentageUsed: number;
    } = {
      status: 'ok',
      currentCost: 0,
      limit: 0,
      remaining: 0,
      percentageUsed: 0,
    };

    try {
      const { costBudgetManager } =
        await import('@modules/cost/CostBudgetManager');
      const statuses = costBudgetManager.getAllBudgetStatuses();
      if (statuses.length > 0) {
        const monthlyStatus = statuses.find(
          (s: { budgetId: string }) => s.budgetId === 'monthly-budget'
        );
        const primary = monthlyStatus || statuses[0];
        budgetInfo = {
          status:
            primary.status === 'exceeded'
              ? 'exceeded'
              : primary.status === 'warning'
                ? 'warning'
                : 'ok',
          currentCost: primary.currentCost,
          limit: primary.limit,
          remaining: primary.remaining,
          percentageUsed: primary.percentageUsed,
        };
      }
    } catch (_err) {
      logger.warn('costBudgetManager 不可用');
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(budgetInfo));
  } catch (err) {
    await handleError(err, { module: 'infra:http', action: 'budget_status' });
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({ error: { message: 'Failed to get budget status' } })
      );
    }
  }
}

// ========== 全局成本统计（从 LocalHTTPService.ts 迁移） ==========

/** 成本报告（CostReportEndpoint 封装） */
export async function handleCostReport(
  ctx: HandlerCtx,
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  const urlObj = new URL(req.url!, `http://${req.headers.host}`);
  const format = urlObj.searchParams.get('format') || 'json';
  const period = urlObj.searchParams.get('period') || 'all';

  const { CostReportEndpoint } =
    await import('@modules/cost/CostReportEndpoint');
  const endpoint = new CostReportEndpoint();
  const result = await endpoint.handle({
    format: format as 'json' | 'text' | 'csv' | 'prometheus',
    period: period as 'today' | 'week' | 'month' | 'custom',
  });

  const contentType =
    format === 'text' || format === 'csv' || format === 'prometheus'
      ? 'text/plain; charset=utf-8'
      : 'application/json; charset=utf-8';

  res.writeHead(200, { 'Content-Type': contentType });
  res.end(result);
}

/** 全局成本摘要（从 SQLite cost_records 聚合） */
export async function handleGlobalCostSummary(
  ctx: HandlerCtx,
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const { getCostRecordRepository } =
      await import('@modules/cost/CostRecordRepository');
    const repo = getCostRecordRepository();

    const now = Date.now();
    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);
    const weekAgo = now - 7 * 24 * 60 * 60 * 1000;
    const monthAgo = now - 30 * 24 * 60 * 60 * 1000;

    const { getDailyCostCache } = await import('@modules/cost/DailyCostCache');
    const dailyCache = getDailyCostCache();

    const { modelPricingService } = await import('@modules/ai');
    const { providerManager } = await import('@modules/ai');
    await Promise.all([
      modelPricingService.initialize(),
      providerManager.initialize(),
    ]);
    const [pricingAll, providers] = await Promise.all([
      modelPricingService.getAllPricing(),
      providerManager.listProviders(),
    ]);
    const providerNameById = new Map(providers.map((p) => [p.id, p.name]));
    const providerNameByModel = new Map<string, string>();
    for (const rec of pricingAll) {
      if (providerNameByModel.has(rec.modelId)) continue;
      const pName = providerNameById.get(rec.providerId);
      if (pName) providerNameByModel.set(rec.modelId, pName);
    }

    const [todayAgg, weekAgg, monthAgg, allAgg, dailyRows, sessionCount] =
      await Promise.all([
        repo.getAggregatedCosts({ startTime: todayStart.getTime() }),
        repo.getAggregatedCosts({ startTime: weekAgo }),
        repo.getAggregatedCosts({ startTime: monthAgo }),
        repo.getAggregatedCosts({}),
        dailyCache.get(repo, weekAgo),
        repo.countSessionSummaries(),
      ]);

    const topProviders = Object.entries(allAgg.modelBreakdown)
      .filter(([, data]) => data.totalCost > 0)
      .map(([modelKey, data]) => ({
        provider: modelKey,
        providerName: providerNameByModel.get(modelKey) || modelKey,
        cost: data.totalCost,
        inputTokens: data.inputTokens,
        outputTokens: data.outputTokens,
        totalTokens: data.totalTokens,
        requests: data.requestCount,
        percentage: 0,
      }))
      .sort((a, b) => b.cost - a.cost)
      .slice(0, 5);

    const topTotal = topProviders.reduce((s, p) => s + p.cost, 0);
    topProviders.forEach((p) => {
      p.percentage = topTotal > 0 ? (p.cost / topTotal) * 100 : 0;
    });

    const response = {
      totalSessions: sessionCount,
      todayCost: todayAgg.totalCostUSD,
      weeklyCost: weekAgg.totalCostUSD,
      monthlyCost: monthAgg.totalCostUSD,
      yearlyCost: allAgg.totalCostUSD,
      todayTokens: todayAgg.totalInputTokens + todayAgg.totalOutputTokens,
      monthlyTokens: monthAgg.totalInputTokens + monthAgg.totalOutputTokens,
      totalInputTokens: allAgg.totalInputTokens,
      totalOutputTokens: allAgg.totalOutputTokens,
      totalTokens: allAgg.totalInputTokens + allAgg.totalOutputTokens,
      totalCacheReadTokens: allAgg.totalCacheReadTokens,
      totalCacheCreationTokens: allAgg.totalCacheCreationTokens,
      totalRequests: allAgg.totalRequests,
      sessionCost: allAgg.totalCostUSD,
      sessionInputTokens: allAgg.totalInputTokens,
      sessionOutputTokens: allAgg.totalOutputTokens,
      sessionTokens: allAgg.totalInputTokens + allAgg.totalOutputTokens,
      topProviders,
      dailyBreakdown: dailyRows.map((d) => ({
        date: d.date,
        cost: d.cost,
        inputTokens: d.inputTokens,
        outputTokens: d.outputTokens,
        requests: d.requests,
      })),
    };

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(response));
  } catch (err) {
    await handleError(err, {
      module: 'infra:http',
      action: 'global_cost_summary',
    });
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: '获取成本摘要失败' } }));
  }
}

/** 全局成本记录列表 GET /api/cost/records?page=&limit= */
export async function handleGlobalCostRecords(
  ctx: HandlerCtx,
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const { getCostRecordRepository } =
      await import('@modules/cost/CostRecordRepository');
    const repo = getCostRecordRepository();

    const url = new URL(req.url || '', 'http://localhost');
    const page = parseInt(url.searchParams.get('page') || '1', 10);
    const limit = parseInt(url.searchParams.get('limit') || '20', 10);
    const offset = (page - 1) * limit;

    const records = await repo.getCostRecords({ limit, offset });

    const formatted = records.map((r) => ({
      id: r.id,
      date: new Date(r.timestamp).toISOString().split('T')[0],
      provider: r.model,
      model: r.model,
      promptTokens: r.inputTokens,
      completionTokens: r.outputTokens,
      totalTokens: r.inputTokens + r.outputTokens,
      cacheReadTokens: r.cacheReadTokens,
      cacheCreationTokens: r.cacheCreationTokens,
      cost: r.costUSD,
      currency: 'USD',
    }));

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ records: formatted, total: formatted.length }));
  } catch (err) {
    await handleError(err, {
      module: 'infra:http',
      action: 'global_cost_records',
    });
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: '获取成本记录失败' } }));
  }
}

/** 按日期范围查询成本 GET /api/cost/range?startDate=&endDate= */
export async function handleGlobalCostRange(
  ctx: HandlerCtx,
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const { getCostRecordRepository } =
      await import('@modules/cost/CostRecordRepository');
    const repo = getCostRecordRepository();

    const url = new URL(req.url || '', 'http://localhost');
    const startDate = url.searchParams.get('startDate');
    const endDate = url.searchParams.get('endDate');

    const startTime = startDate ? new Date(startDate).getTime() : undefined;
    const endTime = endDate
      ? new Date(endDate + 'T23:59:59.999Z').getTime()
      : undefined;

    const records = await repo.getCostRecords({ startTime, endTime });

    const formatted = records.map((r) => ({
      id: r.id,
      date: new Date(r.timestamp).toISOString().split('T')[0],
      provider: r.model,
      model: r.model,
      promptTokens: r.inputTokens,
      completionTokens: r.outputTokens,
      totalTokens: r.inputTokens + r.outputTokens,
      cacheReadTokens: r.cacheReadTokens,
      cacheCreationTokens: r.cacheCreationTokens,
      cost: r.costUSD,
      currency: 'USD',
    }));

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(formatted));
  } catch (err) {
    await handleError(err, {
      module: 'infra:http',
      action: 'global_cost_range',
    });
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: '获取成本范围数据失败' } }));
  }
}

/** 对账 model_usage_logs 与 cost_records GET /api/cost/reconcile */
export async function handleCostReconcile(
  ctx: HandlerCtx,
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const { getCostRecordRepository } =
      await import('@modules/cost/CostRecordRepository');
    const repo = getCostRecordRepository();

    const url = new URL(req.url || '', 'http://localhost');
    const startDate = url.searchParams.get('startDate');
    const endDate = url.searchParams.get('endDate');

    const startTime = startDate ? new Date(startDate).getTime() : undefined;
    const endTime = endDate
      ? new Date(endDate + 'T23:59:59.999Z').getTime()
      : undefined;

    const result = await repo.reconcileUsageAndCost(startTime, endTime);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        ...result,
        total: result.matched + result.onlyInUsage + result.onlyInCost,
        matchRate:
          result.matched + result.onlyInUsage > 0
            ? (
                (result.matched / (result.matched + result.onlyInUsage)) *
                100
              ).toFixed(1) + '%'
            : 'N/A',
      })
    );
  } catch (err) {
    await handleError(err, {
      module: 'infra:http',
      action: 'cost_reconcile',
    });
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: '对账失败' } }));
  }
}
