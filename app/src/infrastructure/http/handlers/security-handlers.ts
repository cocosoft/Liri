/**
 * security-handlers.ts — 安全仪表盘、审计日志查询 HTTP handler
 */

import type http from 'node:http';
import type { HandlerCtx } from './handler-utils';
import { Logger, LogLevel } from '@modules/monitoring';
import { queryAuditLogs, getAuditLogStats } from '@modules/security';

const logger = new Logger({ module: 'http:security', level: LogLevel.INFO });

/**
 * GET /v1/security/dashboard — 安全仪表盘数据
 * 返回规则总数、风险分布、决策分布、最近安全事件
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
        totalRules: stats.totalEvents,
        activePolicies: stats.totalEvents > 0 ? 1 : 0,
        recentEvents: recentEventSummaries,
        riskDistribution,
        decisionDistribution,
      })
    );
  } catch (error) {
    logger.error('获取安全仪表盘数据失败', error as Error);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(
      JSON.stringify({
        totalRules: 0,
        activePolicies: 0,
        recentEvents: [],
        riskDistribution: {},
        decisionDistribution: {},
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const decision = (url.searchParams.get('decision') as any) || undefined;
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
    logger.error('查询审计日志失败', error as Error);
    res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: '查询审计日志失败' }));
  }
}
