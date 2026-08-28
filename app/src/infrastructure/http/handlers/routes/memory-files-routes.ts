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
 * memory-files-routes.ts — dispatchMemoryFilesRoutes
 *
 * 由 route-table.ts 拆分而来（FSZ-002 阶段二：注册式路由收敛，领域分发模块）。
 * 保持与拆分前完全一致的匹配顺序与 handler 调用。
 */

import type http from 'http';
import type { HandlerCtx } from '../handler-utils';
import {
  handleCreateCheckpoint,
  handleDeleteCheckpoint,
  handleGetCheckpoint,
  handleListCheckpoints,
  handleRollbackCheckpoint,
} from '../checkpoint-handlers';
import {
  handleConsolidateMemories,
  handleCreateMemory,
  handleDeleteAllMemories,
  handleDeleteMemory,
  handleDreamCycleDetail,
  handleDreamCyclesList,
  handleDreamMemories,
  handleGetMemory,
  handleGetMemorySummary,
  handleGetMemoryWeights,
  handleGetStats,
  handleGetSyncStatus,
  handleListMemories,
  handleSearchMemories,
  handleSyncMemories,
  handleUpdateMemory,
} from '../memory-handlers';
import {
  handleBuildSemanticIndex,
  handleClearSemanticIndex,
  handleGetSemanticBuildTask,
  handleGetSemanticIndexStatus,
  handleSearchSemantic,
} from '../semantic-index-handlers';
import {
  handleConvertFile,
  handleDetectFileType,
  handleFileUpload,
  handleSendFileToAI,
} from '../file-upload-handlers';
import {
  handleFileHealth,
  handleFileRegistryDelete,
  handleFileRegistryDetail,
  handleFileRegistryList,
  handleFileRegistrySearch,
  handleFileRegistryStats,
} from '../files-handlers';

/**
 * dispatchMemoryFilesRoutes — memory-files-routes 领域路由分发
 * @returns true 表示已匹配并处理，false 表示未匹配
 */
export async function dispatchMemoryFilesRoutes(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: string,
  broadcastEvent: (event: string, data: unknown) => void,
  handlerCtx: HandlerCtx
): Promise<boolean> {
  const method = req.method || 'GET';
  // ---- Checkpoints ----
  if (method === 'POST' && url === '/v1/checkpoints') {
    await handleCreateCheckpoint(handlerCtx, req, res);
    return true;
  }
  if (method === 'GET' && url === '/v1/checkpoints') {
    await handleListCheckpoints(req, res);
    return true;
  }
  if (method === 'GET' && url.match(/^\/v1\/checkpoints\/(.+)$/)) {
    await handleGetCheckpoint(
      handlerCtx,
      req,
      res,
      url.match(/^\/v1\/checkpoints\/(.+)$/)![1]
    );
    return true;
  }
  if (method === 'POST' && url.match(/^\/v1\/checkpoints\/(.+)\/rollback$/)) {
    await handleRollbackCheckpoint(
      handlerCtx,
      req,
      res,
      url.match(/^\/v1\/checkpoints\/(.+)\/rollback$/)![1]
    );
    return true;
  }
  if (method === 'DELETE' && url.match(/^\/v1\/checkpoints\/(.+)$/)) {
    await handleDeleteCheckpoint(
      handlerCtx,
      req,
      res,
      url.match(/^\/v1\/checkpoints\/(.+)$/)![1]
    );
    return true;
  }

  // ---- Memory ----
  if (method === 'POST' && url === '/v1/memory') {
    await handleCreateMemory(req, res);
    return true;
  }
  if (method === 'GET' && url === '/v1/memory') {
    await handleListMemories(req, res);
    return true;
  }
  if (method === 'GET' && url === '/v1/memory/search') {
    await handleSearchMemories(req, res);
    return true;
  }
  if (method === 'GET' && url === '/v1/memory/weights') {
    await handleGetMemoryWeights(req, res);
    return true;
  }
  if (method === 'GET' && url === '/v1/memory/sync-status') {
    await handleGetSyncStatus(req, res);
    return true;
  }
  if (method === 'GET' && url === '/v1/memory/stats') {
    await handleGetStats(req, res);
    return true;
  }
  if (method === 'GET' && url.match(/^\/v1\/memory\/(.+)\/summary$/)) {
    await handleGetMemorySummary(
      req,
      res,
      url.match(/^\/v1\/memory\/(.+)\/summary$/)![1]
    );
    return true;
  }
  if (method === 'GET' && url.match(/^\/v1\/memory\/([^/]+)$/)) {
    await handleGetMemory(req, res, url.match(/^\/v1\/memory\/([^/]+)$/)![1]);
    return true;
  }
  if (method === 'POST' && url === '/v1/memory') {
    await handleCreateMemory(req, res);
    return true;
  }
  if (method === 'POST' && url === '/v1/memory/sync') {
    await handleSyncMemories(req, res);
    return true;
  }
  if (method === 'POST' && url === '/v1/memory/consolidate') {
    await handleConsolidateMemories(req, res);
    return true;
  }
  if (method === 'POST' && url === '/v1/memory/dream') {
    await handleDreamMemories(req, res);
    return true;
  }
  if (method === 'GET' && url === '/v1/memory/dream/cycles') {
    await handleDreamCyclesList(req, res);
    return true;
  }
  const cycleDetailMatch =
    method === 'GET' && url.match(/^\/v1\/memory\/dream\/cycles\/(dream_\d+)$/);
  if (cycleDetailMatch) {
    await handleDreamCycleDetail(req, res, cycleDetailMatch[1]);
    return true;
  }
  if (method === 'PUT' && url.match(/^\/v1\/memory\/(.+)$/)) {
    await handleUpdateMemory(req, res, url.match(/^\/v1\/memory\/(.+)$/)![1]);
    return true;
  }
  if (method === 'DELETE' && url === '/v1/memory') {
    await handleDeleteAllMemories(req, res);
    return true;
  }
  if (method === 'DELETE' && url.match(/^\/v1\/memory\/(.+)$/)) {
    await handleDeleteMemory(req, res, url.match(/^\/v1\/memory\/(.+)$/)![1]);
    return true;
  }

  // ---- Semantic Index ----
  if (method === 'POST' && url === '/v1/semantic/index') {
    await handleBuildSemanticIndex(req, res);
    return true;
  }
  if (method === 'GET' && url === '/v1/semantic/index/task') {
    await handleGetSemanticBuildTask(req, res);
    return true;
  }
  if (method === 'GET' && url === '/v1/semantic/search') {
    await handleSearchSemantic(req, res);
    return true;
  }
  if (method === 'GET' && url === '/v1/semantic/index/status') {
    await handleGetSemanticIndexStatus(req, res);
    return true;
  }
  if (method === 'DELETE' && url === '/v1/semantic/index') {
    await handleClearSemanticIndex(req, res);
    return true;
  }

  // ---- Files ----
  if (method === 'GET' && url === '/v1/files/list') {
    const { handleFileList } = await import('../files-handlers');
    await handleFileList(handlerCtx, req, res);
    return true;
  }
  if (method === 'GET' && url === '/v1/files/read') {
    const { handleFileRead } = await import('../files-handlers');
    await handleFileRead(handlerCtx, req, res);
    return true;
  }
  if (method === 'POST' && url === '/v1/files/upload') {
    await handleFileUpload(handlerCtx, req, res);
    return true;
  }
  if (method === 'POST' && url === '/v1/files/convert') {
    await handleConvertFile(handlerCtx, req, res);
    return true;
  }
  if (method === 'POST' && url === '/v1/files/detect') {
    await handleDetectFileType(handlerCtx, req, res);
    return true;
  }
  if (method === 'POST' && url === '/v1/files/send-to-ai') {
    await handleSendFileToAI(handlerCtx, req, res);
    return true;
  }

  // ---- Files: Registry API ----
  if (method === 'GET' && url === '/v1/files/health') {
    await handleFileHealth(handlerCtx, req, res);
    return true;
  }
  if (method === 'GET' && url === '/v1/files/registry/list') {
    await handleFileRegistryList(handlerCtx, req, res);
    return true;
  }
  if (method === 'GET' && url === '/v1/files/registry/detail') {
    await handleFileRegistryDetail(handlerCtx, req, res);
    return true;
  }
  if (method === 'GET' && url === '/v1/files/registry/search') {
    await handleFileRegistrySearch(handlerCtx, req, res);
    return true;
  }
  if (method === 'GET' && url === '/v1/files/registry/stats') {
    await handleFileRegistryStats(handlerCtx, req, res);
    return true;
  }
  if (method === 'DELETE' && url === '/v1/files/registry/delete') {
    await handleFileRegistryDelete(handlerCtx, req, res);
    return true;
  }
  return false;
}
