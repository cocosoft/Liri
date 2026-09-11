// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * graph-handlers.ts — 知识图谱 HTTP 处理器
 *
 * 端点：
 *   GET  /v1/knowledge/graph/edges?domain=&limit= → 查询边列表
 *   GET  /v1/knowledge/graph/stats → 图统计信息
 *   GET  /v1/knowledge/graph/export → 全量边导出为 JSONL（备份）
 *   POST /v1/knowledge/graph/import → 从 JSONL 恢复（幂等，body 为 JSONL 文本）
 */

import type http from 'http';
import { readRequestBody, sendError, sendErrorMapped } from './handler-utils';
import {
  handleError,
  AppError,
  ErrorCategory,
  ErrorSeverity,
} from '@modules/error';
import type { KnowledgeGraph } from '@modules/knowledge/graph/KnowledgeGraph';

/** GET /v1/knowledge/graph/edges?domain=&limit=&entityId=&type= */
export async function handleListGraphEdges(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  let graph: KnowledgeGraph | null = null;
  try {
    const kgModule = await import('@modules/knowledge/graph/KnowledgeGraph');
    graph = new kgModule.KnowledgeGraph();
    await graph.init();

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
    sendErrorMapped(res, err);
  } finally {
    // P0-1：必须关闭连接，否则每次请求泄漏一个 SQLite 连接 + WAL 句柄
    await graph?.close();
  }
}

/** GET /v1/knowledge/graph/stats */
export async function handleGraphStats(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  let graph: KnowledgeGraph | null = null;
  try {
    const kgModule = await import('@modules/knowledge/graph/KnowledgeGraph');
    graph = new kgModule.KnowledgeGraph();
    await graph.init();

    const stats = await graph.getStats();

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(stats));
  } catch (err) {
    await handleError(err, { module: 'infra:handler:graph', action: 'stats' });
    sendErrorMapped(res, err);
  } finally {
    // P0-1：同 list_edges，避免连接泄漏
    await graph?.close();
  }
}

/**
 * GET /v1/knowledge/graph/export
 * 全量边导出为 JSONL（`exportJsonl()` 原样输出，可被 import 端点原样回灌）
 */
export async function handleExportGraphJsonl(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  let graph: KnowledgeGraph | null = null;
  try {
    // 动态 import 保持与原 handler 一致（避免 HTTP 模块加载期拉起 DB 模块）
    const kgModule = await import('@modules/knowledge/graph/KnowledgeGraph');
    graph = new kgModule.KnowledgeGraph();
    await graph.init();

    const jsonl = await graph.exportJsonl();

    res.writeHead(200, {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Content-Disposition': 'attachment; filename="kg-edges.jsonl"',
    });
    res.end(jsonl);
  } catch (err) {
    await handleError(err, {
      module: 'infra:handler:graph',
      action: 'export_jsonl',
    });
    sendErrorMapped(res, err);
  } finally {
    await graph?.close();
  }
}

/**
 * POST /v1/knowledge/graph/import
 * 请求体为 JSONL 文本（export 端点的原样输出）→ 幂等恢复（INSERT OR IGNORE）
 */
export async function handleImportGraphJsonl(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  let graph: KnowledgeGraph | null = null;
  try {
    const jsonl = await readRequestBody(req);
    if (!jsonl.trim()) {
      // 400 而非 500：请求体为空属于调用方输入问题
      sendError(res, '请求体为空，需为 exportJsonl 产出的 JSONL 文本', 400);
      return;
    }

    const kgModule = await import('@modules/knowledge/graph/KnowledgeGraph');
    graph = new kgModule.KnowledgeGraph();
    await graph.init();

    const result = await graph.importJsonl(jsonl);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));
  } catch (err) {
    await handleError(err, {
      module: 'infra:handler:graph',
      action: 'import_jsonl',
    });
    sendErrorMapped(res, err);
  } finally {
    await graph?.close();
  }
}

/**
 * GET /v1/knowledge/graph/audit?edgeId=&limit=
 * 审计列表（D5 append-only；最新在前）
 */
export async function handleListGraphAudit(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  let graph: KnowledgeGraph | null = null;
  try {
    const url = new URL(req.url!, `http://${req.headers.host ?? 'localhost'}`);
    const edgeId = url.searchParams.get('edgeId') ?? undefined;
    const limit = parseInt(url.searchParams.get('limit') ?? '100', 10);

    graph = await openGraph();
    const entries = await graph.listAudit({ edgeId, limit });

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ entries, total: entries.length }));
  } catch (err) {
    await handleError(err, {
      module: 'infra:handler:graph',
      action: 'list_audit',
    });
    sendErrorMapped(res, err);
  } finally {
    await graph?.close();
  }
}

/**
 * POST /v1/knowledge/graph/audit/:auditId/undo
 * 撤销一次人工操作（D5）：新增→删除、修改→回滚、删除→恢复并解除墓碑
 */
export async function handleUndoGraphAudit(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  auditId: string
): Promise<void> {
  let graph: KnowledgeGraph | null = null;
  try {
    graph = await openGraph();
    const result = await graph.undoAudit(auditId);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ undone: true, ...result }));
  } catch (err) {
    await handleError(err, {
      module: 'infra:handler:graph',
      action: 'undo_audit',
    });
    sendErrorMapped(res, err);
  } finally {
    await graph?.close();
  }
}

// ===========================================================================
// B3：图数据人工维护（CRUD）
// ===========================================================================

/** 批量导入单次上限（防超大请求打爆写入） */
const MAX_BULK_EDGES = 1000;

/** 打开一个已初始化的 KnowledgeGraph（调用方负责 finally close） */
async function openGraph(): Promise<KnowledgeGraph> {
  const kgModule = await import('@modules/knowledge/graph/KnowledgeGraph');
  const graph = new kgModule.KnowledgeGraph();
  await graph.init();
  return graph;
}

/** 读取并解析 JSON 请求体（空体 → {}；非法 → AppError(VALIDATION) → 400） */
async function parseJsonBody(
  req: http.IncomingMessage
): Promise<Record<string, unknown>> {
  const raw = await readRequestBody(req);
  if (!raw.trim()) return {};

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // @ignore-catch 解析失败统一转 400（VALIDATION），无需进 ErrorTracker
    throw new AppError(
      '请求体不是合法 JSON',
      ErrorCategory.VALIDATION,
      ErrorSeverity.LOW,
      'KG_INVALID_BODY',
      { module: 'infra:handler:graph' }
    );
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new AppError(
      '请求体应为 JSON 对象',
      ErrorCategory.VALIDATION,
      ErrorSeverity.LOW,
      'KG_INVALID_BODY',
      { module: 'infra:handler:graph' }
    );
  }
  return parsed as Record<string, unknown>;
}

/** 必填非空字符串字段 */
function requireString(obj: Record<string, unknown>, key: string): string {
  const value = obj[key];
  if (typeof value !== 'string' || !value.trim()) {
    throw new AppError(
      `字段 ${key} 必填，且必须是非空字符串`,
      ErrorCategory.VALIDATION,
      ErrorSeverity.LOW,
      'KG_INVALID_BODY',
      { module: 'infra:handler:graph' }
    );
  }
  return value;
}

/** 可选字符串字段 */
function optionalString(
  obj: Record<string, unknown>,
  key: string
): string | undefined {
  const value = obj[key];
  return typeof value === 'string' && value.trim() ? value : undefined;
}

/** 把请求体转成 addEdge 入参（人工写入统一打 source:'manual'，为 D3 冲突治理铺底） */
function bodyToEdgeInput(body: Record<string, unknown>): {
  from: string;
  to: string;
  type: string;
  direction?: 'directed' | 'symmetric';
  domain?: string;
  attributes: Record<string, unknown>;
} {
  const attributes = body.attributes;
  const attrs =
    typeof attributes === 'object' &&
    attributes !== null &&
    !Array.isArray(attributes)
      ? (attributes as Record<string, unknown>)
      : {};
  return {
    from: requireString(body, 'from'),
    to: requireString(body, 'to'),
    type: requireString(body, 'type'),
    direction: body.direction === 'symmetric' ? 'symmetric' : 'directed',
    domain: optionalString(body, 'domain'),
    attributes: { source: 'manual', ...attrs },
  };
}

/**
 * POST /v1/knowledge/graph/edges
 * 新增关系（D8 幂等：同 (from,to,type,domain) 已存在时返回既有边）
 */
export async function handleCreateGraphEdge(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  let graph: KnowledgeGraph | null = null;
  try {
    const body = await parseJsonBody(req);
    const input = bodyToEdgeInput(body);

    graph = await openGraph();
    // D3/M1：人工写入 → origin='manual'（同键墓碑会被清除，人工意图最新）
    const edge = await graph.addEdge(input, { origin: 'manual' });
    if (!edge) {
      throw new AppError(
        '边写入未返回记录',
        ErrorCategory.DATABASE,
        ErrorSeverity.HIGH,
        'KG_EDGE_WRITE_NO_RESULT',
        { module: 'infra:handler:graph' }
      );
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ edge }));
  } catch (err) {
    await handleError(err, {
      module: 'infra:handler:graph',
      action: 'create_edge',
    });
    sendErrorMapped(res, err);
  } finally {
    await graph?.close();
  }
}

/**
 * PATCH /v1/knowledge/graph/edges/:id
 * 修改 type / direction / attributes（attributes 为合并语义）
 */
export async function handleUpdateGraphEdge(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  edgeId: string
): Promise<void> {
  let graph: KnowledgeGraph | null = null;
  try {
    const body = await parseJsonBody(req);
    const attributes = body.attributes;
    const patch = {
      type: optionalString(body, 'type'),
      direction:
        body.direction === 'symmetric'
          ? ('symmetric' as const)
          : body.direction === 'directed'
            ? ('directed' as const)
            : undefined,
      attributes:
        typeof attributes === 'object' &&
        attributes !== null &&
        !Array.isArray(attributes)
          ? (attributes as Record<string, unknown>)
          : undefined,
    };

    graph = await openGraph();
    const edge = await graph.updateEdge(edgeId, patch);
    if (!edge) {
      sendError(res, `边不存在：${edgeId}`, 404);
      return;
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ edge }));
  } catch (err) {
    await handleError(err, {
      module: 'infra:handler:graph',
      action: 'update_edge',
    });
    sendErrorMapped(res, err);
  } finally {
    await graph?.close();
  }
}

/**
 * DELETE /v1/knowledge/graph/edges/:id
 * 删除关系（不存在 → 404）
 */
export async function handleDeleteGraphEdge(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  edgeId: string
): Promise<void> {
  let graph: KnowledgeGraph | null = null;
  try {
    graph = await openGraph();
    const existing = await graph.getEdge(edgeId);
    if (!existing) {
      sendError(res, `边不存在：${edgeId}`, 404);
      return;
    }
    // D3/M1 的墓碑记录已在 KnowledgeGraph.deleteEdge 内完成（数据层保证）
    await graph.deleteEdge(edgeId);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ deleted: true, id: edgeId }));
  } catch (err) {
    await handleError(err, {
      module: 'infra:handler:graph',
      action: 'delete_edge',
    });
    sendErrorMapped(res, err);
  } finally {
    await graph?.close();
  }
}

/**
 * POST /v1/knowledge/graph/edges/bulk-delete
 *
 * D4（存量边处置）：按关系类型批量删除该类型的**全部**边。
 * - body：`{ type: string, domain?: string, confirm: true }`（**必须显式 confirm**）
 * - **不提供"删除全部"入口**：`type` 必填且非空
 * - 逐条走 `deleteEdge` → 每条都有墓碑 + 审计（可逐条撤销，且不会被下次抽取加回）
 */
export async function handleBulkDeleteGraphEdges(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  let graph: KnowledgeGraph | null = null;
  try {
    const body = await parseJsonBody(req);
    const type = requireString(body, 'type');
    if (body.confirm !== true) {
      throw new AppError(
        '批量删除需显式确认（body 需含 confirm: true）',
        ErrorCategory.VALIDATION,
        ErrorSeverity.LOW,
        'KG_CONFIRM_REQUIRED',
        { module: 'infra:handler:graph' }
      );
    }
    const domain = optionalString(body, 'domain');

    graph = await openGraph();
    const deleted = await graph.deleteEdgesByType(type, domain);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        deleted,
        type,
        domain: domain ?? null,
        note: '每条删除均写入墓碑与审计，可逐条撤销',
      })
    );
  } catch (err) {
    await handleError(err, {
      module: 'infra:handler:graph',
      action: 'bulk_delete_edges',
    });
    sendErrorMapped(res, err);
  } finally {
    await graph?.close();
  }
}

/** D2-2：把 JSON 值收敛成字符串数组（非法 → undefined，交给服务端校验决定语义） */
function stringArray(value: unknown): string[] | undefined {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : undefined;
}

/** D2-2：把 JSON 值收敛成普通对象 */
function recordValue(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/**
 * POST /v1/knowledge/graph/nodes/merge
 *
 * O15：**合并两个实体** —— 把 `from` 的全部关系改指到 `into` 并删除 `from` 节点。
 * 用于修复"同一实体被写成两个 ID"的历史分裂（如 `plan` 与 `pdca:plan`；实测真实库 4 组）。
 *
 * - 改指后与既有边**同自然键**（D8 `from+to+type+domain`）→ 判为重复并删除被并入的那条（写墓碑 + 审计）
 * - 每条改指写审计（`note` 标明合并方向）→ 可按审计逐条撤销
 * - body `{ from, into, confirm: true }`（**必须显式确认**）
 */
export async function handleMergeGraphNodes(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  let graph: KnowledgeGraph | null = null;
  try {
    const body = await parseJsonBody(req);
    const from = requireString(body, 'from');
    const into = requireString(body, 'into');
    if (body.confirm !== true) {
      throw new AppError(
        '合并需显式确认（body 需含 confirm: true）',
        ErrorCategory.VALIDATION,
        ErrorSeverity.LOW,
        'KG_CONFIRM_REQUIRED',
        { module: 'infra:handler:graph' }
      );
    }

    graph = await openGraph();
    const result = await graph.mergeNodes(from, into);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        merged: true,
        from,
        into,
        repointed: result.repointed,
        deduped: result.deduped,
        note: '改指与去重均写入审计，可逐条撤销',
      })
    );
  } catch (err) {
    await handleError(err, {
      module: 'infra:handler:graph',
      action: 'merge_nodes',
    });
    sendErrorMapped(res, err);
  } finally {
    await graph?.close();
  }
}

/**
 * GET /v1/knowledge/graph/nodes?domain=&limit=&search=
 *
 * D2-2/D2-3：实体（节点）列表 —— **含孤立实体**（`degree=0`），每行带 `degree`。
 * `search` 由**服务端**在 node_id / name / description / kind 上做子串匹配
 * （避免前端只能搜"已加载窗口"内的一小部分）。
 * ⚠️ 必须落在 `GET /v1/knowledge/graph` 兜底分支内（否则被 stats 吞掉，C4）。
 */
export async function handleListGraphNodes(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  let graph: KnowledgeGraph | null = null;
  try {
    const params = new URL(req.url ?? '', 'http://localhost').searchParams;
    const domain = params.get('domain') ?? undefined;
    const search = params.get('search')?.trim() || undefined;
    const rawLimit = Number(params.get('limit') ?? '');
    const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? rawLimit : 200;

    graph = await openGraph();
    const nodes = await graph.listNodes({ domain, limit, search });

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        nodes,
        total: nodes.length,
        limit,
        search: search ?? null,
      })
    );
  } catch (err) {
    await handleError(err, {
      module: 'infra:handler:graph',
      action: 'list_nodes',
    });
    sendErrorMapped(res, err);
  } finally {
    await graph?.close();
  }
}

/** GET /v1/knowledge/graph/nodes/{id} —— 单节点档案（不存在 → 404） */
export async function handleGetGraphNode(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  nodeId: string
): Promise<void> {
  let graph: KnowledgeGraph | null = null;
  try {
    graph = await openGraph();
    const node = await graph.getNode(nodeId);
    if (!node) {
      sendError(res, `实体不存在：${nodeId}`, 404);
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ node }));
  } catch (err) {
    await handleError(err, {
      module: 'infra:handler:graph',
      action: 'get_node',
    });
    sendErrorMapped(res, err);
  } finally {
    await graph?.close();
  }
}

/**
 * POST /v1/knowledge/graph/nodes
 *
 * D2-2：创建实体（**支持孤立实体**，即暂无任何关系）。
 * body `{ id?, domain?, kind?, slug?, name?, description?, aliases?, tags?, attributes? }`：
 * - `id` 即**裸 slug**（O15-B）；也可给 `slug`（等价于 id），二者必居其一
 * - `kind` 为**档案属性**（实体分类标签），不参与 ID 拼接
 * - 以 `origin='manual'` 写入（档案字段立即生效，且后续自动抽取不会覆盖）
 */
export async function handleCreateGraphNode(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  let graph: KnowledgeGraph | null = null;
  try {
    const body = await parseJsonBody(req);
    const domain = optionalString(body, 'domain') ?? 'knowledge';
    const kind = optionalString(body, 'kind') ?? '';
    const slug = optionalString(body, 'slug') ?? '';
    // O15-B：实体 ID 统一为裸 slug —— 不再拼 `${domain}:${kind}:${slug}`
    const id = optionalString(body, 'id') ?? slug;
    if (!id) {
      throw new AppError(
        '创建实体需提供 id（裸 slug）或 slug',
        ErrorCategory.VALIDATION,
        ErrorSeverity.LOW,
        'KG_INVALID_NODE_INPUT',
        { module: 'infra:handler:graph' }
      );
    }

    graph = await openGraph();
    await graph.upsertNode(
      {
        id,
        domain,
        kind,
        slug: id,
        name: optionalString(body, 'name'),
        description: optionalString(body, 'description'),
        aliases: stringArray(body.aliases),
        tags: stringArray(body.tags),
        attributes: recordValue(body.attributes),
      },
      { origin: 'manual' }
    );
    const node = await graph.getNode(id);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ node }));
  } catch (err) {
    await handleError(err, {
      module: 'infra:handler:graph',
      action: 'create_node',
    });
    sendErrorMapped(res, err);
  } finally {
    await graph?.close();
  }
}

/**
 * PATCH /v1/knowledge/graph/nodes/{id}
 *
 * D2-2：更新实体档案（kind / name / description / aliases / tags / attributes）。
 * **身份字段（id）不可改**；不存在或无可更新字段 → 404。
 * O15-B：`kind` 已归为档案属性，可修改。
 */
export async function handleUpdateGraphNode(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  nodeId: string
): Promise<void> {
  let graph: KnowledgeGraph | null = null;
  try {
    const body = await parseJsonBody(req);
    graph = await openGraph();
    const changed = await graph.updateNodeArchive(nodeId, {
      kind: optionalString(body, 'kind'),
      name: optionalString(body, 'name'),
      description: optionalString(body, 'description'),
      aliases: stringArray(body.aliases),
      tags: stringArray(body.tags),
      attributes: recordValue(body.attributes),
    });
    if (changed === 0) {
      sendError(res, `实体不存在或无可更新字段：${nodeId}`, 404);
      return;
    }
    const node = await graph.getNode(nodeId);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ node }));
  } catch (err) {
    await handleError(err, {
      module: 'infra:handler:graph',
      action: 'update_node',
    });
    sendErrorMapped(res, err);
  } finally {
    await graph?.close();
  }
}

/**
 * DELETE /v1/knowledge/graph/nodes/{id}?cascade=true
 *
 * D2-2：删除实体。
 * - 无关联边 → 直接删节点
 * - 有关联边 → 必须显式 `cascade=true`，否则 **400**（避免静默删掉一批关系）
 */
export async function handleDeleteGraphNode(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  nodeId: string
): Promise<void> {
  let graph: KnowledgeGraph | null = null;
  try {
    const params = new URL(req.url ?? '', 'http://localhost').searchParams;
    const cascade = params.get('cascade') === 'true';

    graph = await openGraph();
    const node = await graph.getNode(nodeId);
    if (!node) {
      sendError(res, `实体不存在：${nodeId}`, 404);
      return;
    }

    const related = await graph.queryEdges({
      entityId: nodeId,
      direction: 'both',
      limit: 1,
    });
    if (related.length === 0) {
      await graph.deleteNode(nodeId);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ deleted: true, nodeId, removedEdges: 0 }));
      return;
    }
    if (!cascade) {
      throw new AppError(
        '该实体仍有关联关系；确认级联删除请加 cascade=true',
        ErrorCategory.VALIDATION,
        ErrorSeverity.LOW,
        'KG_NODE_HAS_EDGES',
        { module: 'infra:handler:graph' }
      );
    }

    const removedEdges = await graph.deleteEntity(nodeId);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ deleted: true, nodeId, removedEdges }));
  } catch (err) {
    await handleError(err, {
      module: 'infra:handler:graph',
      action: 'delete_node',
    });
    sendErrorMapped(res, err);
  } finally {
    await graph?.close();
  }
}

/**
 * POST /v1/knowledge/graph/edges/bulk
 * 批量新增（body: `{ edges: [...] }`，D8 幂等；单次 ≤ 1000）
 */
export async function handleBulkCreateGraphEdges(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  let graph: KnowledgeGraph | null = null;
  try {
    const body = await parseJsonBody(req);
    const list = body.edges;
    if (!Array.isArray(list)) {
      throw new AppError(
        '请求体需包含 edges 数组',
        ErrorCategory.VALIDATION,
        ErrorSeverity.LOW,
        'KG_INVALID_BODY',
        { module: 'infra:handler:graph' }
      );
    }
    if (list.length > MAX_BULK_EDGES) {
      throw new AppError(
        `单次批量新增上限为 ${MAX_BULK_EDGES} 条（本次 ${list.length} 条）`,
        ErrorCategory.VALIDATION,
        ErrorSeverity.LOW,
        'KG_BULK_TOO_LARGE',
        { module: 'infra:handler:graph' }
      );
    }

    graph = await openGraph();
    const failed: Array<{ index: number; reason: string }> = [];
    let ok = 0;
    for (let index = 0; index < list.length; index++) {
      try {
        const input = bodyToEdgeInput(list[index] as Record<string, unknown>);
        // D3/M1：批量导入按人工写入处理（清除同键墓碑）
        await graph.addEdge(input, { origin: 'manual' });
        ok++;
      } catch (err) {
        failed.push({
          index,
          reason: err instanceof Error ? err.message : String(err),
        });
      }
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ submitted: list.length, ok, failed }));
  } catch (err) {
    await handleError(err, {
      module: 'infra:handler:graph',
      action: 'bulk_create_edges',
    });
    sendErrorMapped(res, err);
  } finally {
    await graph?.close();
  }
}

/**
 * GET /v1/knowledge/graph/entities?domain=&limit=
 * 列出实体（由边派生：distinct 端点 + 度数）
 *
 * 注：方案 §4.2 的"来源"需 lineage 反查（doc → node），属 B5/D3 范围，本期未返回。
 */
export async function handleListGraphEntities(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  let graph: KnowledgeGraph | null = null;
  try {
    const url = new URL(req.url!, `http://${req.headers.host ?? 'localhost'}`);
    const domain = url.searchParams.get('domain') ?? undefined;
    const limit = parseInt(url.searchParams.get('limit') ?? '200', 10);

    graph = await openGraph();
    const entities = await graph.listEntities({ domain, limit });

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ entities, total: entities.length }));
  } catch (err) {
    await handleError(err, {
      module: 'infra:handler:graph',
      action: 'list_entities',
    });
    sendErrorMapped(res, err);
  } finally {
    await graph?.close();
  }
}

/**
 * DELETE /v1/knowledge/graph/entities/:id
 * 删除实体（= 删除其所有关联边；无关联边 → 404）
 */
export async function handleDeleteGraphEntity(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  entityId: string
): Promise<void> {
  let graph: KnowledgeGraph | null = null;
  try {
    graph = await openGraph();
    // D3/M1 的墓碑记录已在 KnowledgeGraph.deleteEntity 内完成（数据层保证）
    const removedEdges = await graph.deleteEntity(entityId);
    if (removedEdges === 0) {
      sendError(res, `实体不存在或已无关联边：${entityId}`, 404);
      return;
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ deleted: true, id: entityId, removedEdges }));
  } catch (err) {
    await handleError(err, {
      module: 'infra:handler:graph',
      action: 'delete_entity',
    });
    sendErrorMapped(res, err);
  } finally {
    await graph?.close();
  }
}
