/**
 * security-handlers.ts — 安全仪表盘、审计日志查询 HTTP handler
 */

import type http from 'http';
import type { HandlerCtx } from './handler-utils';
import { handleError } from '@modules/error';
import { queryAuditLogs, getAuditLogStats } from '@modules/security';
import { denialTracker, PermissionManager } from '@modules/permission';

/**
 * GET /v1/security/dashboard — 安全仪表盘数据
 * 返回规则总数、风险分布、决策分布、权限拒绝统计、最近安全事件
 */
export async function handleSecurityDashboard(
  _ctx: HandlerCtx,
  _req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const stats = getAuditLogStats();

    // 查询最近 50 条事件用于仪表盘
    const recentEvents = queryAuditLogs({ limit: 50 });

    // 计算风险分布
    const riskDistribution: Record<string, number> = {};
    const decisionDistribution: Record<string, number> = {};

    for (const event of recentEvents) {
      const rl = event.riskLevel || 'unknown';
      riskDistribution[rl] = (riskDistribution[rl] || 0) + 1;

      const dc = event.decision || 'unknown';
      decisionDistribution[dc] = (decisionDistribution[dc] || 0) + 1;
    }

    // 权限拒绝监测统计（DenialTracker 内存态）
    const denialStats = denialTracker.getStats();
    const topDeniedTools = Array.from(denialStats.toolDenials.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([tool, count]) => ({ tool, count }));

    // 权限规则数（A 体系 tool_rules.json 真实规则数，修正 totalRules 语义）
    const ruleSummary = PermissionManager.getInstance().getRulesSummary();

    // 返回最近 20 条摘要
    const recentEventSummaries = recentEvents.slice(0, 20).map((event) => ({
      id: `${event.sessionContext.sessionId}-${event.timestamp.getTime()}`,
      timestamp: event.timestamp.toISOString(),
      decision: event.decision,
      riskLevel: event.riskLevel,
      truncatedResult: event.truncatedResult,
      behavior: event.behavior,
    }));

    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(
      JSON.stringify({
        totalRules: ruleSummary.total,
        activePolicies: ruleSummary.total > 0 ? 1 : 0,
        auditEventCount: stats.totalEvents,
        recentEvents: recentEventSummaries,
        riskDistribution,
        decisionDistribution,
        denialStats: {
          totalDenials: denialStats.totalDenials,
          consecutiveDenials: denialStats.consecutiveDenials,
          averageDenialRate: Number(denialStats.averageDenialRate.toFixed(4)),
          suggestion: denialStats.suggestion,
          topDeniedTools,
        },
      })
    );
  } catch (error) {
    await handleError(error, {
      module: 'infra:handler:security',
      action: 'dashboard',
    });
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(
      JSON.stringify({
        totalRules: 0,
        activePolicies: 0,
        auditEventCount: 0,
        recentEvents: [],
        riskDistribution: {},
        decisionDistribution: {},
        denialStats: {
          totalDenials: 0,
          consecutiveDenials: 0,
          averageDenialRate: 0,
          suggestion: undefined,
          topDeniedTools: [],
        },
      })
    );
  }
}

/**
 * GET /v1/security/audit-logs — 审计日志查询
 * 支持 sessionId / riskLevel / decision / limit 查询参数
 */
export async function handleQueryAuditLogs(
  _ctx: HandlerCtx,
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const url = new URL(
      req.url || '',
      `http://${req.headers.host || 'localhost'}`
    );
    const sessionId = url.searchParams.get('sessionId') || undefined;
    const riskLevel = url.searchParams.get('riskLevel') || undefined;

    const decision = url.searchParams.get('decision') as
      | 'pending'
      | 'approved'
      | 'rejected'
      | 'auto_allowed'
      | 'auto_denied'
      | 'timeout_denied'
      | undefined;
    const limitStr = url.searchParams.get('limit');
    const limit = limitStr ? parseInt(limitStr, 10) : undefined;

    const events = queryAuditLogs({
      sessionId,
      riskLevel,
      decision,
      limit,
    });

    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(events));
  } catch (error) {
    await handleError(error, {
      module: 'infra:handler:security',
      action: 'audit_logs',
    });
    res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: '查询审计日志失败' }));
  }
}
