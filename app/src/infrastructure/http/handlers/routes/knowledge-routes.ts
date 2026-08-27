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
import type { HandlerCtx } from '../handler-utils';
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
    const { handleListGraphEdges, handleGraphStats } =
      await import('@modules/infrastructure/http/handlers/graph-handlers');
    if (
      url === '/v1/knowledge/graph/edges' ||
      url.startsWith('/v1/knowledge/graph/edges?')
    ) {
      await handleListGraphEdges(req, res);
    } else {
      await handleGraphStats(req, res);
    }
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
  if (method === 'PUT' && url.match(/^\/v1\/knowledge\/(?!bases|docs)(.+)$/)) {
    await handleUpdateKnowledge(
      req,
      res,
      url.match(/^\/v1\/knowledge\/(?!bases|docs)(.+)$/)![1]
    );
    return true;
  }
  if (method === 'DELETE' && url.match(/^\/v1\/knowledge\/(?!bases)(.+)$/)) {
    await handleDeleteKnowledge(
      req,
      res,
      url.match(/^\/v1\/knowledge\/(?!bases)(.+)$/)![1]
    );
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
