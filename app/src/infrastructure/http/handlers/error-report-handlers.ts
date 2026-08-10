/**
 * 前端错误上报处理器
 *
 * 接收前端 handleClientError 上报的错误批次，
 * 写入 Logger 并记录到 OTEL。
 *
 * GET /v1/monitoring/errors — 返回后端错误统计（P3-2.11）
 */

import type http from 'http';
import { getLogger } from '../../../monitoring/logs/Logger';
import { handleError } from '../../../error/handleError';
import { getErrorStats } from '../../../error/handleError';

const logger = getLogger('http:error-report');

interface ErrorBatchItem {
  message: string;
  category: string;
  severity: string;
  code?: string;
  module: string;
  action?: string;
  /** 请求 payload key 集合（根因 D：只记键名不记值） */
  payloadKeys?: string[];
  /** React 组件栈（根因 D：定位 UI 层出错组件） */
  componentStack?: string;
  timestamp: number;
  stack?: string;
}

async function parseBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString()));
      } catch {
        resolve(null);
      }
    });
    req.on('error', reject);
  });
}

export async function handleClientErrorReport(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const body = (await parseBody(req)) as { errors: ErrorBatchItem[] } | null;
    if (!body?.errors || !Array.isArray(body.errors)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'missing errors array' }));
      return;
    }

    const count = body.errors.length;
    const severities = new Set(body.errors.map((e) => e.severity));
    const criticalCount = body.errors.filter(
      (e) => e.severity === 'critical' || e.severity === 'high'
    ).length;

    logger.info(`收到前端错误上报: ${count} 条`, {
      count,
      severities: [...severities],
      criticalCount,
      clientModules: [...new Set(body.errors.map((e) => e.module))],
    });

    // 记录每条到错误追踪
    for (const entry of body.errors) {
      logger.warn(`[前端错误] [${entry.module}] ${entry.message}`, {
        category: entry.category,
        severity: entry.severity,
        code: entry.code,
        action: entry.action,
        payloadKeys: entry.payloadKeys,
        componentStack: entry.componentStack,
      });
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, received: count }));
  } catch (err) {
    await handleError(err, {
      module: 'http:error-report',
      action: 'handleClientErrorReport',
    });
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'internal error' }));
  }
}

/**
 * P3-2.11: 返回后端错误统计
 * GET /v1/monitoring/errors
 */
export function handleGetErrorStats(
  _req: http.IncomingMessage,
  res: http.ServerResponse
): void {
  try {
    const stats = getErrorStats();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(stats));
  } catch (_err) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'failed to get error stats' }));
  }
}
