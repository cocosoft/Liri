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
// C1（2026-09-30 D-95，`knowledge` 域 P1）：改经服务层端口
import { getCoreAPI } from '@modules/runtime/api/CoreAPIImpl';

/** GET /v1/knowledge/graph/edges?domain=&limit=&entityId=&type= */
export async function handleListGraphEdges(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const url = new URL(req.url!, `http://${req.headers.host ?? 'localhost'}`);
    const domain = url.searchParams.get('domain') ?? undefined;
    const entityId = url.searchParams.get('entityId') ?? undefined;
    const type = url.searchParams.get('type') ?? undefined;
    const limit = parseInt(url.searchParams.get('limit') ?? '200', 10);

    // `new KnowledgeGraph()` + `init()` 已内聚到端口实现
    const port = await getCoreAPI().getKnowledgeOpsPort();
    const edges = await port.queryKnowledgeGraphEdges({
      domain,
      entityId,
      type,
      limit,
    });
    const stats = await port.getKnowledgeGraphStats();

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
    const stats = await (
      await getCoreAPI().getKnowledgeOpsPort()
    ).getKnowledgeGraphStats();

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(stats));
  } catch (err) {
    await handleError(err, { module: 'infra:handler:graph', action: 'stats' });
    sendError(res, (err as Error).message, 500);
  }
}
