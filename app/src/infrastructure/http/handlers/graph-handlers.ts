// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * graph-handlers.ts — 知识图谱 HTTP 处理器
 *
 * 端点：
 *   GET  /v1/knowledge/graph/edges?domain=&limit= → 查询边列表
 *   GET  /v1/knowledge/graph/stats → 图统计信息
 */

import type http from 'http';
import { sendError } from './handler-utils';
import { handleError } from '@modules/error';

/** GET /v1/knowledge/graph/edges?domain=&limit=&entityId=&type= */
export async function handleListGraphEdges(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const { KnowledgeGraph } =
      await import('@modules/knowledge/graph/KnowledgeGraph');
    const graph = new KnowledgeGraph();
    await graph['init']();

    const url = new URL(req.url!, `http://${req.headers.host ?? 'localhost'}`);
    const domain = url.searchParams.get('domain') ?? undefined;
    const entityId = url.searchParams.get('entityId') ?? undefined;
    const type = url.searchParams.get('type') ?? undefined;
    const limit = parseInt(url.searchParams.get('limit') ?? '200', 10);

    const edges = await graph.queryEdges({ domain, entityId, type, limit });
    const stats = await graph.getStats();

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        edges,
        stats: {
          totalEdges: stats.totalEdges,
          byType: stats.byType,
          totalEntities: stats.totalEntities,
        },
      })
    );
  } catch (err) {
    await handleError(err, {
      module: 'infra:handler:graph',
      action: 'list_edges',
    });
    sendError(res, (err as Error).message, 500);
  }
}

/** GET /v1/knowledge/graph/stats */
export async function handleGraphStats(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const { KnowledgeGraph } =
      await import('@modules/knowledge/graph/KnowledgeGraph');
    const graph = new KnowledgeGraph();
    await graph['init']();

    const stats = await graph.getStats();

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(stats));
  } catch (err) {
    await handleError(err, { module: 'infra:handler:graph', action: 'stats' });
    sendError(res, (err as Error).message, 500);
  }
}
