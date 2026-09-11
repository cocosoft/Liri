// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

/**
 * knowledge-routes.ts — dispatchKnowledgeRoutes
 *
 * 由 route-table.ts 拆分而来（FSZ-002 阶段二：注册式路由收敛，领域分发模块）。
 * 保持与拆分前完全一致的匹配顺序与 handler 调用。
 */

import type http from 'http';
import { sendError, type HandlerCtx } from '../handler-utils';
import {
  handleGetAgentModelBindings,
  handleGetOrchestrationHistory,
  handleGetOrchestrationSnapshot,
  handleGetSwarmStatus,
  handleOrchestrationStream,
  handleUpdateAgentModelBindings,
} from '../orchestration-handlers';
import {
  handleBatchDeleteKnowledge,
  handleBatchTagKnowledge,
  handleCloneKnowledgeBase,
  handleCreateKnowledge,
  handleCreateKnowledgeBase,
  handleDeleteKnowledge,
  handleDeleteKnowledgeBase,
  handleDuplicateKnowledgeBase,
  handleExportKnowledge,
  handleExportToNotebook,
  handleGetRawFiles,
  handleGetKnowledgeDoc,
  handleImportFromFile,
  handleKnowledgeCompile,
  handleKnowledgeCompileStatus,
  handleKnowledgeHealth,
  handleKnowledgeUpload,
  handleListKnowledge,
  handleListKnowledgeBases,
  handleListSnapshots,
  handleRestoreSnapshot,
  handleRestoreTrash,
  handleSaveFromChat,
  handleSearchKnowledge,
  handleTrashKnowledge,
  handleUpdateKnowledge,
  handleUpdateKnowledgeBase,
  handleUpdateKnowledgeDoc,
} from '../knowledge-handlers';
import {
  handleBatchDeleteFAQ,
  handleCreateFAQ,
  handleDeleteFAQ,
  handleFAQCategories,
  handleImportFAQ,
  handleListFAQ,
  handleSearchFAQ,
  handleUpdateFAQ,
} from '../faq-handlers';
import {
  handleAddTeamMember,
  handleCreateTeam,
  handleDeleteTeam,
  handleGetTeam,
  handleListTeams,
  handleRemoveTeamMember,
  handleUpdateMemberRole,
  handleUpdateTeam,
} from '../team-handlers';

/**
 * 已由专用路由占用的 `/v1/knowledge/<seg>` 命名空间（O3 根因修复，2026-09-11）
 *
 * 为什么需要这份清单：文件靠后的 `PUT/DELETE /v1/knowledge/{id}` 是"文档 id"通配，
 * 一旦某个专用命名空间未被上面的专用路由命中，就会被当成**文档路径**处理 ——
 * 例如 `DELETE /v1/knowledge/graph/edges/xxx` 会被当作"删除文档 id=graph/edges/xxx"。
 * 此前只靠"注册顺序 + 仅排除 bases|docs"规避，属**顺序依赖的脆弱设计**
 * （且 DELETE 通配连 `docs` 都没排除）：任何人把新路由加在通配之后就会踩坑，
 * 失败形态是"误删文档 / 误导 404"。
 *
 * 现在改为：① 文档 id 通配排除**全部**保留段；② 保留段下未被专用路由命中的
 * 写请求（PUT/PATCH/DELETE）明确返回 404，而不是继续走文档路径。
 *
 * 注意：这里是**整段匹配**（`seg` 后必须跟 `/` 或结束），因此 `health-status`
 * 这类以保留词开头的文档 id 不受影响。
 */
const RESERVED_KNOWLEDGE_SEGMENTS = [
  'bases',
  'docs',
  'domains',
  'graph',
  'schema',
  'snapshots',
  'trash',
  'export',
  'export-to-notebook',
  'import-from-file',
  'ingest',
  'batch-delete',
  'batch-tag',
  'datasources',
  'upload',
  'save-from-chat',
  'compile',
  'compile-status',
  'lineage',
  'raw-files',
  'raw-preview',
  'health',
  'config',
  'search',
  'doc',
] as const;

/** 保留段正则片段（供负向断言与 404 守卫共用，避免三处各写一份） */
const RESERVED_SEGMENT_ALT = RESERVED_KNOWLEDGE_SEGMENTS.join('|');

/** 命中保留命名空间（含其子路径） */
const RESERVED_NAMESPACE_RE = new RegExp(
  `^/v1/knowledge/(?:${RESERVED_SEGMENT_ALT})(?:/|$)`
);

/** 文档 id 通配：排除全部保留命名空间 */
const KNOWLEDGE_DOC_ID_RE = new RegExp(
  `^/v1/knowledge/(?!(?:${RESERVED_SEGMENT_ALT})(?:/|$))(.+)$`
);

/**
 * dispatchKnowledgeRoutes — knowledge-routes 领域路由分发
 * @returns true 表示已匹配并处理，false 表示未匹配
 */
export async function dispatchKnowledgeRoutes(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: string,
  broadcastEvent: (event: string, data: unknown) => void,
  handlerCtx: HandlerCtx
): Promise<boolean> {
  const method = req.method || 'GET';
  // ---- Knowledge ----
  if (
    method === 'GET' &&
    url.match(/^\/v1\/workspaces\/(.+)\/items\/(.+)\/orchestration\/stream$/)
  ) {
    const match = url.match(
      /^\/v1\/workspaces\/(.+)\/items\/(.+)\/orchestration\/stream$/
    )!;
    await handleOrchestrationStream(handlerCtx, req, res, match[1], match[2]);
    return true;
  }
  if (
    method === 'GET' &&
    url.match(/^\/v1\/workspaces\/(.+)\/items\/(.+)\/orchestration\/history$/)
  ) {
    const match = url.match(
      /^\/v1\/workspaces\/(.+)\/items\/(.+)\/orchestration\/history$/
    )!;
    await handleGetOrchestrationHistory(
      handlerCtx,
      req,
      res,
      match[1],
      match[2]
    );
    return true;
  }
  if (
    method === 'GET' &&
    url.match(/^\/v1\/workspaces\/(.+)\/items\/(.+)\/orchestration$/)
  ) {
    const match = url.match(
      /^\/v1\/workspaces\/(.+)\/items\/(.+)\/orchestration$/
    )!;
    await handleGetOrchestrationSnapshot(
      handlerCtx,
      req,
      res,
      match[1],
      match[2]
    );
    return true;
  }
  if (method === 'GET' && url.match(/^\/v1\/workspaces\/(.+)\/swarm$/)) {
    const workspaceId = url.match(/^\/v1\/workspaces\/(.+)\/swarm$/)![1];
    await handleGetSwarmStatus(handlerCtx, req, res, workspaceId);
    return true;
  }
  if (
    method === 'GET' &&
    url.match(/^\/v1\/workspaces\/(.+)\/agent-model-bindings$/)
  ) {
    const workspaceId = url.match(
      /^\/v1\/workspaces\/(.+)\/agent-model-bindings$/
    )![1];
    await handleGetAgentModelBindings(handlerCtx, req, res, workspaceId);
    return true;
  }
  if (
    method === 'PUT' &&
    url.match(/^\/v1\/workspaces\/(.+)\/agent-model-bindings$/)
  ) {
    const workspaceId = url.match(
      /^\/v1\/workspaces\/(.+)\/agent-model-bindings$/
    )![1];
    await handleUpdateAgentModelBindings(handlerCtx, req, res, workspaceId);
    return true;
  }

  // ---- Knowledge ----
  if (method === 'GET' && url === '/v1/knowledge') {
    await handleListKnowledge(req, res);
    return true;
  }
  // KB-DOC（2026-08-27）：单文档读取（编辑器/详情按需拉全文）
  if (method === 'GET' && url === '/v1/knowledge/doc') {
    await handleGetKnowledgeDoc(req, res);
    return true;
  }
  // F5：原文 raw 文件内嵌预览（PDF；iframe/#page=N）
  if (method === 'GET' && url.startsWith('/v1/knowledge/raw-preview')) {
    const { handleKnowledgeRawPreview } =
      await import('@modules/infrastructure/http/handlers/knowledge-handlers');
    await handleKnowledgeRawPreview(req, res);
    return true;
  }
  if (method === 'POST' && url === '/v1/knowledge/search') {
    await handleSearchKnowledge(req, res);
    return true;
  }
  if (method === 'POST' && url === '/v1/knowledge') {
    await handleCreateKnowledge(req, res);
    return true;
  }
  if (method === 'GET' && url === '/v1/knowledge/bases') {
    await handleListKnowledgeBases(req, res);
    return true;
  }
  if (method === 'POST' && url === '/v1/knowledge/bases') {
    await handleCreateKnowledgeBase(req, res);
    return true;
  }
  if (method === 'PUT' && url.match(/^\/v1\/knowledge\/bases\/(.+)$/)) {
    await handleUpdateKnowledgeBase(
      req,
      res,
      url.match(/^\/v1\/knowledge\/bases\/(.+)$/)![1]
    );
    return true;
  }
  if (method === 'DELETE' && url.match(/^\/v1\/knowledge\/bases\/(.+)$/)) {
    await handleDeleteKnowledgeBase(
      req,
      res,
      url.match(/^\/v1\/knowledge\/bases\/(.+)$/)![1]
    );
    return true;
  }
  if (method === 'POST' && url.match(/^\/v1\/knowledge\/bases\/(.+)\/clone$/)) {
    await handleCloneKnowledgeBase(
      req,
      res,
      url.match(/^\/v1\/knowledge\/bases\/(.+)\/clone$/)![1]
    );
    return true;
  }
  if (
    method === 'POST' &&
    url.match(/^\/v1\/knowledge\/bases\/(.+)\/duplicate$/)
  ) {
    await handleDuplicateKnowledgeBase(
      req,
      res,
      url.match(/^\/v1\/knowledge\/bases\/(.+)\/duplicate$/)![1]
    );
    return true;
  }
  if (method === 'POST' && url === '/v1/knowledge/save-from-chat') {
    await handleSaveFromChat(req, res);
    return true;
  }
  if (method === 'POST' && url === '/v1/knowledge/upload') {
    await handleKnowledgeUpload(req, res);
    return true;
  }
  if (method === 'POST' && url === '/v1/knowledge/compile') {
    await handleKnowledgeCompile(req, res);
    return true;
  }
  if (method === 'GET' && url === '/v1/knowledge/compile-status') {
    await handleKnowledgeCompileStatus(req, res);
    return true;
  }
  // R6：血缘反查（doc ↔ 产物双向）
  if (method === 'GET' && url === '/v1/knowledge/lineage') {
    const { handleKnowledgeLineage } =
      await import('@modules/infrastructure/http/handlers/knowledge-handlers');
    await handleKnowledgeLineage(req, res);
    return true;
  }
  if (method === 'GET' && url === '/v1/knowledge/raw-files') {
    await handleGetRawFiles(req, res);
    return true;
  }
  if (method === 'GET' && url === '/v1/knowledge/health') {
    await handleKnowledgeHealth(req, res);
    return true;
  }
  if (method === 'GET' && url === '/v1/knowledge/config') {
    const { handleGetKnowledgeConfig } =
      await import('@modules/infrastructure/http/handlers/knowledge-handlers');
    await handleGetKnowledgeConfig(req, res);
    return true;
  }
  if (method === 'PUT' && url === '/v1/knowledge/config') {
    const { handleUpdateKnowledgeConfig } =
      await import('@modules/infrastructure/http/handlers/knowledge-handlers');
    await handleUpdateKnowledgeConfig(req, res);
    return true;
  }
  // 数据源管理
  if (url.startsWith('/v1/knowledge/datasources')) {
    const {
      handleListDataSources,
      handleCreateDataSource,
      handleDeleteDataSource,
      handleSyncDataSource,
    } =
      await import('@modules/infrastructure/http/handlers/datasource-handlers');
    if (method === 'GET' && url === '/v1/knowledge/datasources') {
      await handleListDataSources(req, res);
    } else if (method === 'POST' && url === '/v1/knowledge/datasources') {
      await handleCreateDataSource(req, res);
    } else if (method === 'DELETE') {
      await handleDeleteDataSource(req, res);
    } else if (method === 'POST' && url.endsWith('/sync')) {
      await handleSyncDataSource(req, res);
    } else {
      res.writeHead(405);
      res.end('Method not allowed');
    }
    return true;
  }
  if (method === 'GET' && url.startsWith('/v1/knowledge/graph')) {
    const {
      handleListGraphEdges,
      handleGraphStats,
      handleExportGraphJsonl,
      handleListGraphEntities,
      handleListGraphAudit,
      handleListGraphNodes,
      handleGetGraphNode,
    } = await import('@modules/infrastructure/http/handlers/graph-handlers');
    if (
      url === '/v1/knowledge/graph/edges' ||
      url.startsWith('/v1/knowledge/graph/edges?')
    ) {
      await handleListGraphEdges(req, res);
    } else if (url === '/v1/knowledge/graph/export') {
      await handleExportGraphJsonl(req, res);
    } else if (
      url === '/v1/knowledge/graph/nodes' ||
      url.startsWith('/v1/knowledge/graph/nodes?')
    ) {
      // D2-2：实体（节点）列表 —— 同样必须在兜底分支内，否则被 stats 吞掉
      await handleListGraphNodes(req, res);
    } else if (url.match(/^\/v1\/knowledge\/graph\/nodes\/[^/]+$/)) {
      // D2-2：单节点档案
      await handleGetGraphNode(
        req,
        res,
        decodeURIComponent(url.split('/').pop()!)
      );
    } else if (
      url === '/v1/knowledge/graph/entities' ||
      url.startsWith('/v1/knowledge/graph/entities?')
    ) {
      // B3：实体列表必须落在本兜底分支内（否则会被 handleGraphStats 吞掉）
      await handleListGraphEntities(req, res);
    } else if (
      url === '/v1/knowledge/graph/audit' ||
      url.startsWith('/v1/knowledge/graph/audit?')
    ) {
      // D5：审计列表同样必须在兜底分支内
      await handleListGraphAudit(req, res);
    } else {
      await handleGraphStats(req, res);
    }
    return true;
  }
  // 图数据恢复：必须注册在下方 PUT/DELETE 通配之前（通配会把 graph/... 当文档路径处理）
  if (method === 'POST' && url === '/v1/knowledge/graph/import') {
    const { handleImportGraphJsonl } =
      await import('@modules/infrastructure/http/handlers/graph-handlers');
    await handleImportGraphJsonl(req, res);
    return true;
  }

  // ---- D5 审计撤销：同样必须先于 PUT/DELETE 通配 ----
  if (
    method === 'POST' &&
    url.match(/^\/v1\/knowledge\/graph\/audit\/([^/]+)\/undo$/)
  ) {
    const { handleUndoGraphAudit } =
      await import('@modules/infrastructure/http/handlers/graph-handlers');
    const auditId = decodeURIComponent(
      url.match(/^\/v1\/knowledge\/graph\/audit\/([^/]+)\/undo$/)![1]
    );
    await handleUndoGraphAudit(req, res, auditId);
    return true;
  }

  // ---- B3 图数据人工维护（CRUD）：同样必须先于 PUT/DELETE 通配 ----
  if (method === 'POST' && url === '/v1/knowledge/graph/edges') {
    const { handleCreateGraphEdge } =
      await import('@modules/infrastructure/http/handlers/graph-handlers');
    await handleCreateGraphEdge(req, res);
    return true;
  }
  // D4：按关系类型批量删除（存量边处置；必须早于下方通用分支）
  if (method === 'POST' && url === '/v1/knowledge/graph/edges/bulk-delete') {
    const { handleBulkDeleteGraphEdges } =
      await import('@modules/infrastructure/http/handlers/graph-handlers');
    await handleBulkDeleteGraphEdges(req, res);
    return true;
  }
  // O15：合并实体（必须在 `/nodes` 精确匹配之外单独注册；`/nodes` 是精确相等，不会误吞）
  if (method === 'POST' && url === '/v1/knowledge/graph/nodes/merge') {
    const { handleMergeGraphNodes } =
      await import('@modules/infrastructure/http/handlers/graph-handlers');
    await handleMergeGraphNodes(req, res);
    return true;
  }
  // D2-2：实体（节点）档案 CRUD（创建支持孤立实体；删除有边时需 cascade=true）
  if (method === 'POST' && url === '/v1/knowledge/graph/nodes') {
    const { handleCreateGraphNode } =
      await import('@modules/infrastructure/http/handlers/graph-handlers');
    await handleCreateGraphNode(req, res);
    return true;
  }
  if (
    method === 'PATCH' &&
    url.match(/^\/v1\/knowledge\/graph\/nodes\/[^/]+$/)
  ) {
    const { handleUpdateGraphNode } =
      await import('@modules/infrastructure/http/handlers/graph-handlers');
    await handleUpdateGraphNode(
      req,
      res,
      decodeURIComponent(url.split('/').pop()!)
    );
    return true;
  }
  if (
    method === 'DELETE' &&
    url.match(/^\/v1\/knowledge\/graph\/nodes\/[^/]+$/)
  ) {
    const { handleDeleteGraphNode } =
      await import('@modules/infrastructure/http/handlers/graph-handlers');
    await handleDeleteGraphNode(
      req,
      res,
      decodeURIComponent(url.split('/').pop()!)
    );
    return true;
  }
  if (method === 'POST' && url === '/v1/knowledge/graph/edges/bulk') {
    const { handleBulkCreateGraphEdges } =
      await import('@modules/infrastructure/http/handlers/graph-handlers');
    await handleBulkCreateGraphEdges(req, res);
    return true;
  }
  if (
    method === 'PATCH' &&
    url.match(/^\/v1\/knowledge\/graph\/edges\/([^/]+)$/)
  ) {
    const { handleUpdateGraphEdge } =
      await import('@modules/infrastructure/http/handlers/graph-handlers');
    const edgeId = decodeURIComponent(
      url.match(/^\/v1\/knowledge\/graph\/edges\/([^/]+)$/)![1]
    );
    await handleUpdateGraphEdge(req, res, edgeId);
    return true;
  }
  if (
    method === 'DELETE' &&
    url.match(/^\/v1\/knowledge\/graph\/edges\/([^/]+)$/)
  ) {
    const { handleDeleteGraphEdge } =
      await import('@modules/infrastructure/http/handlers/graph-handlers');
    const edgeId = decodeURIComponent(
      url.match(/^\/v1\/knowledge\/graph\/edges\/([^/]+)$/)![1]
    );
    await handleDeleteGraphEdge(req, res, edgeId);
    return true;
  }
  if (
    method === 'DELETE' &&
    url.match(/^\/v1\/knowledge\/graph\/entities\/(.+)$/)
  ) {
    const { handleDeleteGraphEntity } =
      await import('@modules/infrastructure/http/handlers/graph-handlers');
    const entityId = decodeURIComponent(
      url.match(/^\/v1\/knowledge\/graph\/entities\/(.+)$/)![1]
    );
    await handleDeleteGraphEntity(req, res, entityId);
    return true;
  }
  // D6-3：知识域清单（默认域始终在列表内；只读）
  if (method === 'GET' && url === '/v1/knowledge/domains') {
    const { handleListKnowledgeDomains } =
      await import('@modules/infrastructure/http/handlers/domain-handlers');
    await handleListKnowledgeDomains(req, res);
    return true;
  }
  // 本体 schema（只读）：不落在 graph 兜底分支内，且必须先于下方 PUT/DELETE 通配
  if (method === 'GET' && url === '/v1/knowledge/schema') {
    const { handleGetKnowledgeSchema } =
      await import('@modules/infrastructure/http/handlers/schema-handlers');
    await handleGetKnowledgeSchema(req, res);
    return true;
  }
  // D1/B2c：备份列表 / 恢复（必须早于下方 PUT 通配）
  if (method === 'GET' && url === '/v1/knowledge/schema/backup') {
    const { handleListKnowledgeSchemaBackups } =
      await import('@modules/infrastructure/http/handlers/schema-handlers');
    await handleListKnowledgeSchemaBackups(req, res);
    return true;
  }
  if (
    method === 'POST' &&
    url.match(/^\/v1\/knowledge\/schema\/backup\/[^/]+\/restore$/)
  ) {
    const { handleRestoreKnowledgeSchemaBackup } =
      await import('@modules/infrastructure/http/handlers/schema-handlers');
    const backupId = url.split('/')[5];
    await handleRestoreKnowledgeSchemaBackup(req, res, backupId);
    return true;
  }
  if (method === 'POST' && url === '/v1/knowledge/schema/validate') {
    const { handleValidateKnowledgeSchema } =
      await import('@modules/infrastructure/http/handlers/schema-handlers');
    await handleValidateKnowledgeSchema(req, res);
    return true;
  }
  // D1/B2b：本体草稿 diff 预览（只读，与 validate 同源）
  if (method === 'POST' && url === '/v1/knowledge/schema/diff') {
    const { handleDiffKnowledgeSchema } =
      await import('@modules/infrastructure/http/handlers/schema-handlers');
    await handleDiffKnowledgeSchema(req, res);
    return true;
  }
  if (method === 'POST' && url === '/v1/knowledge/schema/scaffold') {
    const { handleScaffoldKnowledgeSchema } =
      await import('@modules/infrastructure/http/handlers/schema-handlers');
    await handleScaffoldKnowledgeSchema(req, res);
    return true;
  }
  // D1/B2a：本体文件写入 —— 必须在下方 `/v1/knowledge/(?!bases|docs)(.+)` PUT 通配之前，
  // 否则 `PUT /v1/knowledge/schema/edges.yaml` 会被当成"更新文档 id=schema/edges.yaml"
  //
  // 正则覆盖整个 `/v1/knowledge/schema/<单段>` 命名空间（不限后缀，也不限 entities/edges）：
  // 支持哪些文件由 handler 白名单判定（不支持的返回明确 400）。
  // 否则写 `xref.yaml` 或写错文件名（如 typo.yml / typo）会落到下面的 PUT 通配，
  // 被当成"更新文档 id=schema/xxx" → 500，提示完全误导。
  if (method === 'PUT' && url.match(/^\/v1\/knowledge\/schema\/[^/]+$/)) {
    const { handlePutKnowledgeSchemaFile } =
      await import('@modules/infrastructure/http/handlers/schema-handlers');
    const file = url.split('/').pop()!;
    await handlePutKnowledgeSchemaFile(req, res, file);
    return true;
  }
  if (method === 'GET' && url.startsWith('/v1/knowledge/snapshots')) {
    await handleListSnapshots(req, res);
    return true;
  }
  if (method === 'POST' && url === '/v1/knowledge/restore') {
    await handleRestoreSnapshot(req, res);
    return true;
  }
  if (method === 'POST' && url === '/v1/knowledge/trash') {
    await handleTrashKnowledge(req, res);
    return true;
  }
  if (method === 'POST' && url === '/v1/knowledge/restore-trash') {
    await handleRestoreTrash(req, res);
    return true;
  }
  // P2#18：回收站查看/永久删除
  if (method === 'GET' && url.startsWith('/v1/knowledge/trash')) {
    const { handleListKnowledgeTrash } =
      await import('@modules/infrastructure/http/handlers/knowledge-handlers');
    await handleListKnowledgeTrash(req, res);
    return true;
  }
  if (method === 'DELETE' && url.startsWith('/v1/knowledge/trash')) {
    const { handlePurgeKnowledgeTrash } =
      await import('@modules/infrastructure/http/handlers/knowledge-handlers');
    await handlePurgeKnowledgeTrash(req, res);
    return true;
  }
  if (method === 'GET' && url.startsWith('/v1/knowledge/export')) {
    await handleExportKnowledge(req, res);
    return true;
  }
  if (method === 'PUT' && url === '/v1/knowledge/docs') {
    await handleUpdateKnowledgeDoc(req, res);
    return true;
  }
  if (method === 'POST' && url === '/v1/knowledge/export-to-notebook') {
    await handleExportToNotebook(req, res);
    return true;
  }
  if (method === 'POST' && url === '/v1/knowledge/import-from-file') {
    await handleImportFromFile(req, res);
    return true;
  }
  if (method === 'POST' && url === '/v1/knowledge/ingest') {
    await handleImportFromFile(req, res);
    return true;
  }
  if (method === 'POST' && url === '/v1/knowledge/batch-delete') {
    await handleBatchDeleteKnowledge(req, res);
    return true;
  }
  if (method === 'POST' && url === '/v1/knowledge/batch-tag') {
    await handleBatchTagKnowledge(req, res);
    return true;
  }

  // ---- FAQ ----
  if (
    method === 'GET' &&
    url.match(/^\/v1\/knowledge\/([^/]+)\/faq\/categories$/)
  ) {
    await handleFAQCategories(req, res);
    return true;
  }
  if (method === 'GET' && url.match(/^\/v1\/knowledge\/([^/]+)\/faq\/search/)) {
    await handleSearchFAQ(req, res);
    return true;
  }
  if (method === 'GET' && url.match(/^\/v1\/knowledge\/([^/]+)\/faq$/)) {
    await handleListFAQ(req, res);
    return true;
  }
  if (
    method === 'POST' &&
    url.match(/^\/v1\/knowledge\/([^/]+)\/faq\/import$/)
  ) {
    await handleImportFAQ(req, res);
    return true;
  }
  if (
    method === 'POST' &&
    url.match(/^\/v1\/knowledge\/([^/]+)\/faq\/batch-delete$/)
  ) {
    await handleBatchDeleteFAQ(req, res);
    return true;
  }
  if (method === 'POST' && url.match(/^\/v1\/knowledge\/([^/]+)\/faq$/)) {
    await handleCreateFAQ(req, res);
    return true;
  }
  if (
    method === 'PUT' &&
    url.match(/^\/v1\/knowledge\/([^/]+)\/faq\/([^/]+)$/)
  ) {
    await handleUpdateFAQ(req, res);
    return true;
  }
  if (
    method === 'DELETE' &&
    url.match(/^\/v1\/knowledge\/([^/]+)\/faq\/([^/]+)$/)
  ) {
    await handleDeleteFAQ(req, res);
    return true;
  }

  // ---- Knowledge (generic) ----
  // O3：保留命名空间下未被任何专用路由命中的写请求 → 明确 404，
  // **不再落到"文档 id"通配**（否则会出现"把 graph/edges/xxx 当文档删"这类误导行为）。
  // 该守卫与注册顺序无关，新路由加在通配之后也不会被误判为文档 id。
  if (
    (method === 'PUT' || method === 'PATCH' || method === 'DELETE') &&
    RESERVED_NAMESPACE_RE.test(url)
  ) {
    sendError(res, `未实现的接口：${method} ${url}`, 404);
    return true;
  }

  const docIdMatch = url.match(KNOWLEDGE_DOC_ID_RE);
  if (method === 'PUT' && docIdMatch) {
    await handleUpdateKnowledge(req, res, docIdMatch[1]);
    return true;
  }
  if (method === 'DELETE' && docIdMatch) {
    await handleDeleteKnowledge(req, res, docIdMatch[1]);
    return true;
  }

  // ---- Teams ----
  if (method === 'GET' && url.match(/^\/v1\/workspaces\/(.+)\/teams$/)) {
    const workspaceId = url.match(/^\/v1\/workspaces\/(.+)\/teams$/)![1];
    await handleListTeams(handlerCtx, req, res, workspaceId);
    return true;
  }
  if (method === 'POST' && url.match(/^\/v1\/workspaces\/(.+)\/teams$/)) {
    const workspaceId = url.match(/^\/v1\/workspaces\/(.+)\/teams$/)![1];
    await handleCreateTeam(handlerCtx, req, res, workspaceId);
    return true;
  }
  if (
    method === 'GET' &&
    url.match(/^\/v1\/workspaces\/(.+)\/teams\/([^/]+)$/)
  ) {
    const match = url.match(/^\/v1\/workspaces\/(.+)\/teams\/([^/]+)$/)!;
    await handleGetTeam(handlerCtx, req, res, match[1], match[2]);
    return true;
  }
  if (
    method === 'PUT' &&
    url.match(/^\/v1\/workspaces\/(.+)\/teams\/([^/]+)$/)
  ) {
    const match = url.match(/^\/v1\/workspaces\/(.+)\/teams\/([^/]+)$/)!;
    await handleUpdateTeam(handlerCtx, req, res, match[1], match[2]);
    return true;
  }
  if (
    method === 'DELETE' &&
    url.match(/^\/v1\/workspaces\/(.+)\/teams\/([^/]+)$/)
  ) {
    const match = url.match(/^\/v1\/workspaces\/(.+)\/teams\/([^/]+)$/)!;
    await handleDeleteTeam(handlerCtx, req, res, match[1], match[2]);
    return true;
  }
  if (
    method === 'POST' &&
    url.match(/^\/v1\/workspaces\/(.+)\/teams\/([^/]+)\/members$/)
  ) {
    const match = url.match(
      /^\/v1\/workspaces\/(.+)\/teams\/([^/]+)\/members$/
    )!;
    await handleAddTeamMember(handlerCtx, req, res, match[1], match[2]);
    return true;
  }
  if (
    method === 'DELETE' &&
    url.match(/^\/v1\/workspaces\/(.+)\/teams\/([^/]+)\/members\/([^/]+)$/)
  ) {
    const match = url.match(
      /^\/v1\/workspaces\/(.+)\/teams\/([^/]+)\/members\/([^/]+)$/
    )!;
    await handleRemoveTeamMember(
      handlerCtx,
      req,
      res,
      match[1],
      match[2],
      match[3]
    );
    return true;
  }
  if (
    method === 'PUT' &&
    url.match(
      /^\/v1\/workspaces\/(.+)\/teams\/([^/]+)\/members\/([^/]+)\/role$/
    )
  ) {
    const match = url.match(
      /^\/v1\/workspaces\/(.+)\/teams\/([^/]+)\/members\/([^/]+)\/role$/
    )!;
    await handleUpdateMemberRole(
      handlerCtx,
      req,
      res,
      match[1],
      match[2],
      match[3]
    );
    return true;
  }
  return false;
}
