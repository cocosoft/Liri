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
 * auth-access-routes.ts — dispatchAuthAccessRoutes
 *
 * 由 route-table.ts 拆分而来（FSZ-002 阶段二：注册式路由收敛，领域分发模块）。
 * 保持与拆分前完全一致的匹配顺序与 handler 调用。
 */

import type http from 'http';
import type { HandlerCtx } from '../handler-utils';
import {
  handleAuthLogin,
  handleAuthLogout,
  handleAuthMe,
  handleAuthPermissions,
  handleAuthRegister,
} from '../auth-handlers';
import {
  handleCreateApiKey,
  handleDeleteApiKey,
  handleListApiKeys,
} from '../apikey-handlers';
import {
  handleFileOpen,
  handleFilePaths,
  handleFilePreview,
  handleFileRead,
  handleFileResolvePath,
} from '../file-access-handlers';
import {
  handleCreateAgentRole,
  handleDeleteAgentRole,
  handleGetAgentRole,
  handleListAgentRoles,
  handleUpdateAgentRole,
} from '../agent-role-handlers';
import {
  handleMediaSubtitleDownload,
  handleMediaSubtitleGenerate,
} from '../media-handlers';
import { tryHandleRoute } from '@modules/ai';

/**
 * dispatchAuthAccessRoutes — auth-access-routes 领域路由分发
 * @returns true 表示已匹配并处理，false 表示未匹配
 */
export async function dispatchAuthAccessRoutes(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: string,
  broadcastEvent: (event: string, data: unknown) => void,
  handlerCtx: HandlerCtx
): Promise<boolean> {
  const method = req.method || 'GET';
  // ---- Auth ----
  if (method === 'POST' && url === '/v1/auth/login') {
    await handleAuthLogin(req, res);
    return true;
  }
  if (method === 'POST' && url === '/v1/auth/register') {
    await handleAuthRegister(req, res);
    return true;
  }
  if (method === 'POST' && url === '/v1/auth/logout') {
    await handleAuthLogout(req, res);
    return true;
  }
  if (method === 'GET' && url === '/v1/auth/me') {
    await handleAuthMe(req, res);
    return true;
  }
  if (method === 'GET' && url === '/v1/auth/permissions') {
    await handleAuthPermissions(req, res);
    return true;
  }

  // ---- OAuth Provider 运维入口（M3）----
  if (method === 'GET' && url === '/v1/oauth/providers') {
    const { handleListOAuthProviders } = await import('../oauth-handlers');
    await handleListOAuthProviders(req, res);
    return true;
  }
  if (method === 'PUT' && url.match(/^\/v1\/oauth\/providers\/(.+)$/)) {
    const { handleUpdateOAuthProvider } = await import('../oauth-handlers');
    await handleUpdateOAuthProvider(
      req,
      res,
      url.match(/^\/v1\/oauth\/providers\/(.+)$/)![1]
    );
    return true;
  }

  // ---- API Keys ----
  if (method === 'GET' && url === '/v1/apikeys') {
    await handleListApiKeys(req, res);
    return true;
  }
  if (method === 'POST' && url === '/v1/apikeys') {
    await handleCreateApiKey(req, res);
    return true;
  }
  if (method === 'DELETE' && url.match(/^\/v1\/apikeys\/(.+)$/)) {
    await handleDeleteApiKey(req, res, url.match(/^\/v1\/apikeys\/(.+)$/)![1]);
    return true;
  }

  // ---- File Open/Read/Paths/Resolve/Preview ----
  if (method === 'GET' && url === '/api/file/open') {
    await handleFileOpen(handlerCtx, req, res);
    return true;
  }
  if (method === 'GET' && url === '/api/file/read') {
    await handleFileRead(handlerCtx, req, res);
    return true;
  }
  if (method === 'GET' && url === '/api/file/paths') {
    await handleFilePaths(handlerCtx, req, res);
    return true;
  }
  if (method === 'GET' && url === '/api/file/resolve-path') {
    await handleFileResolvePath(handlerCtx, req, res);
    return true;
  }
  if (method === 'GET' && url === '/api/file/preview') {
    await handleFilePreview(handlerCtx, req, res);
    return true;
  }
  if (method === 'GET' && url.startsWith('/api/file/stream')) {
    const { handleFileStream } = await import('../memory-handlers');
    await handleFileStream(req, res);
    return true;
  }
  if (method === 'GET' && url.startsWith('/api/file/html/')) {
    const { handleFileHtmlServe } = await import('../file-access-handlers');
    await handleFileHtmlServe(req, res);
    return true;
  }

  // ---- Agent Roles ----
  if (method === 'GET' && url === '/v1/agent-roles') {
    await handleListAgentRoles(handlerCtx, req, res);
    return true;
  }
  if (method === 'GET' && url.match(/^\/v1\/agent-roles\/([^/]+)$/)) {
    const agentId = url.match(/^\/v1\/agent-roles\/([^/]+)$/)![1];
    await handleGetAgentRole(handlerCtx, req, res, agentId);
    return true;
  }
  if (method === 'POST' && url === '/v1/agent-roles') {
    await handleCreateAgentRole(handlerCtx, req, res);
    return true;
  }
  if (method === 'PUT' && url.match(/^\/v1\/agent-roles\/([^/]+)$/)) {
    const agentId = url.match(/^\/v1\/agent-roles\/([^/]+)$/)![1];
    await handleUpdateAgentRole(handlerCtx, req, res, agentId);
    return true;
  }
  if (method === 'DELETE' && url.match(/^\/v1\/agent-roles\/([^/]+)$/)) {
    const agentId = url.match(/^\/v1\/agent-roles\/([^/]+)$/)![1];
    await handleDeleteAgentRole(handlerCtx, req, res, agentId);
    return true;
  }

  // ---- Health ----
  if (method === 'GET' && url === '/health') {
    let dream;
    try {
      const { readMetrics } =
        await import('../../../../../src/dream/DreamMetrics');
      dream = await readMetrics();
    } catch {
      // 指标文件不存在或读取失败，不影响健康检查
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({ status: 'ok', service: 'LocalHTTPService', dream })
    );
    return true;
  }

  // ---- Media Subtitle ----
  if (method === 'POST' && url === '/v1/media/subtitle') {
    await handleMediaSubtitleGenerate(req, res);
    return true;
  }
  if (
    method === 'GET' &&
    url.match(/^\/v1\/media\/subtitle\/(.+)\/download$/)
  ) {
    await handleMediaSubtitleDownload(
      req,
      res,
      url.match(/^\/v1\/media\/subtitle\/(.+)\/download$/)![1]
    );
    return true;
  }

  // ---- Model Management API (Providers / Usage / Balance / Pricing) ----
  const handled = await tryHandleRoute(req, res);
  if (handled) return true;

  // ---- Office / doc 模块 API ----
  if (method === 'GET' && url === '/v1/officecli/status') {
    const { handleOfficeCLIStatus } = await import('@modules/doc');
    await handleOfficeCLIStatus(req, res);
    return true;
  }
  if (method === 'POST' && url === '/v1/officecli/install') {
    const { handleOfficeCLIInstall } = await import('@modules/doc');
    await handleOfficeCLIInstall(req, res);
    return true;
  }
  if (method === 'GET' && url === '/v1/doc/status') {
    const { handleDocStatus } = await import('@modules/doc');
    await handleDocStatus(req, res);
    return true;
  }
  if (method === 'GET' && url === '/v1/doc/capabilities') {
    const { handleDocCapabilities } = await import('@modules/doc');
    await handleDocCapabilities(req, res);
    return true;
  }
  if (method === 'POST' && url === '/v1/doc/detect') {
    const { handleDocDetect } = await import('@modules/doc');
    await handleDocDetect(req, res);
    return true;
  }
  if (method === 'POST' && url === '/v1/doc/undo') {
    const { handleDocUndo } = await import('@modules/doc');
    await handleDocUndo(req, res);
    return true;
  }
  if (method === 'POST' && url === '/v1/doc/create') {
    const { handleDocCreate } = await import('@modules/doc');
    await handleDocCreate(req, res);
    return true;
  }
  if (method === 'POST' && url === '/v1/doc/rename') {
    const { handleDocRename } = await import('@modules/doc');
    await handleDocRename(req, res);
    return true;
  }
  if (method === 'DELETE' && url.startsWith('/v1/doc/delete')) {
    const { handleDocDelete } = await import('@modules/doc');
    await handleDocDelete(req, res);
    return true;
  }
  if (method === 'POST' && url === '/v1/doc/upload') {
    const { handleDocUpload } = await import('@modules/doc');
    await handleDocUpload(req, res);
    return true;
  }
  if (method === 'GET' && url.startsWith('/v1/doc/download')) {
    const { handleDocDownload } = await import('@modules/doc');
    await handleDocDownload(req, res);
    return true;
  }
  if (method === 'GET' && url.startsWith('/v1/doc/graph')) {
    const { handleDocGraph } = await import('@modules/doc');
    await handleDocGraph(req, res);
    return true;
  }

  // ---- Office / mail 模块 API ----
  if (method === 'GET' && url === '/v1/mail/status') {
    const { handleMailStatus } = await import('@modules/doc');
    await handleMailStatus(req, res);
    return true;
  }
  if (method === 'POST' && url === '/v1/mail/config') {
    const { handleMailConfig } = await import('@modules/doc');
    await handleMailConfig(req, res);
    return true;
  }
  if (method === 'GET' && url === '/v1/mail/config') {
    const { handleMailConfigRead } = await import('@modules/doc');
    await handleMailConfigRead(req, res);
    return true;
  }
  if (method === 'DELETE' && url === '/v1/mail/config') {
    const { handleMailConfigDelete } = await import('@modules/doc');
    await handleMailConfigDelete(req, res);
    return true;
  }
  if (method === 'POST' && url === '/v1/mail/send') {
    const { handleMailSend } = await import('@modules/doc');
    await handleMailSend(req, res);
    return true;
  }
  if (method === 'GET' && url.startsWith('/v1/mail/inbox')) {
    const { handleMailInbox } = await import('@modules/doc');
    await handleMailInbox(req, res);
    return true;
  }
  if (method === 'GET' && url.startsWith('/v1/mail/search')) {
    const { handleMailSearch } = await import('@modules/doc');
    await handleMailSearch(req, res);
    return true;
  }
  if (method === 'GET' && url.startsWith('/v1/mail/sent')) {
    const { handleMailSent } = await import('@modules/doc');
    await handleMailSent(req, res);
    return true;
  }
  if (
    method === 'PATCH' &&
    url.startsWith('/v1/mail/') &&
    url.endsWith('/read')
  ) {
    const { handleMailPatchRead } = await import('@modules/doc');
    await handleMailPatchRead(req, res);
    return true;
  }
  if (
    method === 'DELETE' &&
    url.startsWith('/v1/mail/') &&
    url !== '/v1/mail/config'
  ) {
    const { handleMailDelete } = await import('@modules/doc');
    await handleMailDelete(req, res);
    return true;
  }
  if (method === 'POST' && url === '/v1/mail/refresh') {
    const { handleMailRefresh } = await import('@modules/doc');
    await handleMailRefresh(req, res);
    return true;
  }

  // ---- Office / calendar 模块 API ----
  // 精确匹配在前，避免被 startsWith 误匹配
  if (method === 'GET' && url === '/v1/calendar/status') {
    const { handleCalendarStatus } = await import('@modules/doc');
    await handleCalendarStatus(req, res);
    return true;
  }
  if (method === 'GET' && url === '/v1/calendar/events') {
    const { handleCalendarList } = await import('@modules/doc');
    await handleCalendarList(req, res);
    return true;
  }
  if (method === 'POST' && url === '/v1/calendar/events') {
    const { handleCalendarAdd } = await import('@modules/doc');
    await handleCalendarAdd(req, res);
    return true;
  }
  // 新端点：状态更新和超时检测（必须在泛匹配 /v1/calendar/events/ 之前）
  if (method === 'POST' && url === '/v1/calendar/events/batch-status') {
    const { handleCalendarBatchStatus } = await import('@modules/doc');
    await handleCalendarBatchStatus(req, res);
    return true;
  }
  if (method === 'GET' && url === '/v1/calendar/overdue-check') {
    const { handleCalendarOverdueCheck } = await import('@modules/doc');
    await handleCalendarOverdueCheck(req, res);
    return true;
  }
  if (
    method === 'PATCH' &&
    url.match(/^\/v1\/calendar\/events\/(.+)\/status$/)
  ) {
    const { handleCalendarUpdateStatus } = await import('@modules/doc');
    await handleCalendarUpdateStatus(req, res);
    return true;
  }
  // 带参数匹配在后（export/:id 在 events/:id 之前避免 export 被 events 匹配）
  if (method === 'GET' && url.startsWith('/v1/calendar/export/')) {
    const { handleCalendarExport } = await import('@modules/doc');
    await handleCalendarExport(req, res);
    return true;
  }
  if (method === 'PUT' && url.startsWith('/v1/calendar/events/')) {
    const { handleCalendarUpdate } = await import('@modules/doc');
    await handleCalendarUpdate(req, res);
    return true;
  }
  if (method === 'DELETE' && url.startsWith('/v1/calendar/events/')) {
    const { handleCalendarDelete } = await import('@modules/doc');
    await handleCalendarDelete(req, res);
    return true;
  }
  if (method === 'GET' && url.startsWith('/v1/calendar/merged')) {
    const { handleCalendarMerged } = await import('@modules/doc');
    await handleCalendarMerged(req, res);
    return true;
  }

  // ---- Git Context (Phase 3) ----
  if (method === 'GET' && url === '/v1/git/status') {
    const { getGitContextService } =
      await import('@modules/context/GitContextService');
    const git = getGitContextService();
    const isRepo = await git.isGitRepository();
    if (!isRepo) {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ isGitRepo: false }));
      return true;
    }
    const info = await git.getGitStatus();
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ isGitRepo: true, ...info }));
    return true;
  }
  return false;
}
