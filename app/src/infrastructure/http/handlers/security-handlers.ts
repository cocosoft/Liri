/**
 * security-handlers.ts — 安全仪表盘、审计日志查询 HTTP handler
 */

import type http from 'http';
import type { HandlerCtx } from './handler-utils';
import { handleError } from '@modules/error';
import { queryAuditLogs } from '@modules/security';
import { denialTracker, PermissionManager } from '@modules/permission';

/** 解析可选日期参数（ISO 或 epoch ms），非法返回 undefined */
function parseDateParam(value: string | null): Date | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

/** 本地日期键（YYYY-MM-DD） */
function fmtDay(d: Date): string {
  const y = d.getFullYear();
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * GET /v1/security/dashboard?from=&to= — 安全仪表盘数据
 * 返回规则总数、风险分布、决策分布、权限拒绝统计、最近安全事件、
 * 时间窗按日决策趋势（trend）与越权拦截类别 Top（topBlockKinds，2-1 数据源）
 */
export async function handleSecurityDashboard(
  _ctx: HandlerCtx,
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    // 2-4（2026-09-03）：from/to 时间窗（默认近 7 天）
    const url = new URL(req.url ?? '/', 'http://localhost');
    const from = parseDateParam(url.searchParams.get('from'));
    const to = parseDateParam(url.searchParams.get('to'));
    const now = new Date();
    const windowStart =
      from ?? new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const windowEnd = to ?? now;

    // 评审 3 修复（2026-09-03）：单次全量读后内存过滤窗口——
    // 去掉 getAuditLogStats 的重复整文件同步读；auditEventCount 用全量数组长度。
    const allEvents = queryAuditLogs({});
    const windowStartMs = windowStart.getTime();
    const windowEndMs = windowEnd.getTime();
    const windowEvents = allEvents.filter((e) => {
      const ts = e.timestamp.getTime();
      return ts >= windowStartMs && ts <= windowEndMs;
    });

    // 最近事件 = 窗口内最新 20 条（事件按时间追加，末尾最新）
    const recentEvents = windowEvents.slice(-20).reverse();

    // 计算风险分布与决策分布（窗口内）
    const riskDistribution: Record<string, number> = {};
    const decisionDistribution: Record<string, number> = {};
    for (const event of windowEvents) {
      const rl = event.riskLevel || 'unknown';
      riskDistribution[rl] = (riskDistribution[rl] || 0) + 1;
      const dc = event.decision || 'unknown';
      decisionDistribution[dc] = (decisionDistribution[dc] || 0) + 1;
    }

    // 按日决策趋势（近 7 日，升序）
    const dayKeys: string[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(windowEnd.getTime() - i * 24 * 60 * 60 * 1000);
      dayKeys.push(fmtDay(d));
    }
    const dayMap = new Map<string, Record<string, number>>(
      dayKeys.map((k) => [k, {}])
    );
    for (const event of windowEvents) {
      const key = fmtDay(event.timestamp);
      const bucket = dayMap.get(key);
      if (!bucket) continue;
      bucket[event.decision] = (bucket[event.decision] || 0) + 1;
    }
    const trend = dayKeys.map((date) => ({
      date,
      counts: dayMap.get(date) ?? {},
    }));

    // 越权拦截类别 Top（2-1 logSecurityBlock 事件：decision=auto_denied, matchedRules 标类别）
    const blockKinds = new Map<string, number>();
    for (const event of windowEvents) {
      if (event.decision !== 'auto_denied') continue;
      const kind = event.matchedRules[0] ?? 'UNKNOWN';
      blockKinds.set(kind, (blockKinds.get(kind) ?? 0) + 1);
    }
    const topBlockKinds = Array.from(blockKinds.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([kind, count]) => ({ kind, count }));

    // 权限拒绝监测统计（DenialTracker 内存态）
    const denialStats = denialTracker.getStats();
    const topDeniedTools = Array.from(denialStats.toolDenials.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([tool, count]) => ({ tool, count }));

    // 权限规则数（A 体系 tool_rules.json 真实规则数，修正 totalRules 语义）
    const ruleSummary = PermissionManager.getInstance().getRulesSummary();

    // 返回最近事件摘要
    const recentEventSummaries = recentEvents.map((event) => ({
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
        auditEventCount: allEvents.length,
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
        // 2-4（2026-09-03）：新增趋势/越权类别字段
        windowStart: windowStart.toISOString(),
        windowEnd: windowEnd.toISOString(),
        trend,
        topBlockKinds,
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
        windowStart: null,
        windowEnd: null,
        trend: [],
        topBlockKinds: [],
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
