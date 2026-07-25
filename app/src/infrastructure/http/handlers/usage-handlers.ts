/**
 * Usage 统计端点 — /v1/usage
 *
 * 提供跨会话 Token 消耗、工具调用、子 Agent 使用量统计。
 * 支持时间范围聚合：?range=today|7d|30d
 */

import type http from 'http';
import { sendError, type HandlerCtx } from './handler-utils';
import { Logger } from '@modules/monitoring';
import { getOTelTracing } from '@modules/monitoring/otel/OTelTracing.js';
import { SpanStatusCode } from '@opentelemetry/api';
import { handleError } from '@modules/error';

const logger = new Logger({ module: 'http:usage' });

/** 解析时间范围参数 */
function parseRange(raw?: string): { range: string; startDate?: string } {
  if (!raw || raw === 'current') return { range: 'current' };
  if (raw === 'today')
    return {
      range: 'today',
      startDate: new Date().toISOString().split('T')[0],
    };
  const daysMatch = raw.match(/^(\d+)d$/);
  if (daysMatch) {
    const days = parseInt(daysMatch[1], 10);
    const d = new Date();
    d.setDate(d.getDate() - days);
    return { range: `${days}d`, startDate: d.toISOString().split('T')[0] };
  }
  return { range: raw };
}

/** 处理 GET /v1/usage */
export async function handleGetUsage(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  ctx: HandlerCtx
): Promise<void> {
  const otel = getOTelTracing();
  const span = otel.startSpan('usage.query', {});

  try {
    const url = new URL(req.url || '/', 'http://localhost');
    const rangeParam = url.searchParams.get('range') || 'current';
    const sessionId = url.searchParams.get('sessionId') || undefined;
    const { range, startDate } = parseRange(rangeParam);

    span.setAttribute('usage.range', range);
    if (sessionId) span.setAttribute('usage.sessionId', sessionId);

    // 当前会话统计（内存实时）
    const usage = {
      range,
      sessions: 1,
      totalTokens: 0,
      byModel: {} as Record<string, number>,
      toolCalls: {} as Record<string, number>,
      subAgents: {} as Record<string, number>,
      cost: { estimated: 0, currency: 'USD' },
    };

    // TODO: 从 TokenTracker / CostTracker / QueryLogStore 读取实际数据
    // 当前返回框架占位，待 P4 完整实现时接入真实数据源
    logger.info('Usage query', { range, sessionId });

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(usage));

    span.setAttribute('usage.totalTokens', 0);
    otel.endSpan(span, SpanStatusCode.OK);
  } catch (e) {
    await handleError(e, {
      module: 'http:usage',
      action: 'handleGetUsage',
    });
    otel.recordError(span, e instanceof Error ? e : new Error(String(e)));
    otel.endSpan(span, SpanStatusCode.ERROR, String(e));
    sendError(
      res,
      `Usage query failed: ${e instanceof Error ? e.message : String(e)}`,
      500
    );
  }
}
