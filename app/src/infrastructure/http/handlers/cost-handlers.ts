/**
 * 对话式成本感知 API Handler
 *
 * 集成现有 CostTracker 和 CostBudgetManager，提供工作空间成本查询：
 * - GET /v1/workspaces/:id/cost/report  — 成本报告
 * - GET /v1/workspaces/:id/cost/budget  — 预算状态
 */

import type http from "node:http";
import type { HandlerCtx } from "./handler-utils";
import { handleError } from "@modules/error";
import { Logger, LogLevel } from "@modules/monitoring";
import { resolveWorkspacePath } from "./workspaces-handlers";
import type { CostReport } from "@modules/workspace/types";

const logger = new Logger({ level: LogLevel.INFO });

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
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { message: "Workspace not found" } }));
      return;
    }

    // 从现有 costTracker 获取成本数据
    let totalCostUSD = 0;
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    const modelBreakdown: Record<string, { model: string; costUSD: number; tokens: number; requestCount: number }> = {};

    try {
      const { costTracker } = await import("@modules/cost/CostTracker");
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
    } catch {
      logger.warn("costTracker 不可用，返回空报告");
    }

    // 从 costBudgetManager 获取预算状态
    let budgetStatus: "ok" | "warning" | "exceeded" = "ok";
    let budgetUtilization = 0;

    try {
      const { costBudgetManager } = await import("@modules/cost/CostBudgetManager");
      const statuses = costBudgetManager.getAllBudgetStatuses();
      if (statuses.length > 0) {
        // 使用第一个启用的预算状态
        const monthlyStatus = statuses.find((s: { budgetId: string }) => s.budgetId === "monthly-budget");
        const primary = monthlyStatus || statuses[0];
        if (primary.status === "exceeded") {
          budgetStatus = "exceeded";
        } else if (primary.status === "warning") {
          budgetStatus = "warning";
        }
        budgetUtilization = primary.percentageUsed / 100;
      }
    } catch {
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
      period: "total",
    };

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(report));
  } catch (err) {
    await handleError(err, { module: "infra:http", action: "cost_report" });
    if (!res.headersSent) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { message: "Failed to get cost report" } }));
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
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { message: "Workspace not found" } }));
      return;
    }

    let budgetInfo: {
      status: "ok" | "warning" | "exceeded";
      currentCost: number;
      limit: number;
      remaining: number;
      percentageUsed: number;
    } = {
      status: "ok",
      currentCost: 0,
      limit: 0,
      remaining: 0,
      percentageUsed: 0,
    };

    try {
      const { costBudgetManager } = await import("@modules/cost/CostBudgetManager");
      const statuses = costBudgetManager.getAllBudgetStatuses();
      if (statuses.length > 0) {
        const monthlyStatus = statuses.find((s: { budgetId: string }) => s.budgetId === "monthly-budget");
        const primary = monthlyStatus || statuses[0];
        budgetInfo = {
          status: primary.status === "exceeded" ? "exceeded" : primary.status === "warning" ? "warning" : "ok",
          currentCost: primary.currentCost,
          limit: primary.limit,
          remaining: primary.remaining,
          percentageUsed: primary.percentageUsed,
        };
      }
    } catch {
      logger.warn("costBudgetManager 不可用");
    }

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(budgetInfo));
  } catch (err) {
    await handleError(err, { module: "infra:http", action: "budget_status" });
    if (!res.headersSent) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { message: "Failed to get budget status" } }));
    }
  }
}