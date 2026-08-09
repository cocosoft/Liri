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
 * task-agent-routes.ts — dispatchTaskAgentRoutes
 *
 * 由 route-table.ts 拆分而来（FSZ-002 阶段二：注册式路由收敛，领域分发模块）。
 * 保持与拆分前完全一致的匹配顺序与 handler 调用。
 */

import type http from 'http';
import type { HandlerCtx } from '../handler-utils';
import {
  handleCancelTask,
  handleListTasks,
  handleRemoveTask,
} from '../task-handlers';
import {
  handleExecuteAgentTask,
  handleGetAgentProgress,
  handleListAgentTasks,
} from '../agent1-handlers';
import {
  handleAgentTaskChat,
  handleCancelAgentTask,
  handleGetAgentTaskAudit,
  handleGetAgentTaskLogs,
  handleGetAgentTaskOutput,
  handleGetAgentTaskState,
  handleRecoverAgentTask,
} from '../agent2-handlers';
import {
  handleBindPersona,
  handleCreatePersona,
  handleDeletePersona,
  handleEndVoiceSession,
  handleGetDefaultPersona,
  handleGetPersona,
  handleGetVoiceSession,
  handleGetVoiceSettings,
  handleListPersonaBindings,
  handleListPersonas,
  handleListTTSProviders,
  handleListVoiceProviders,
  handleListVoiceSessions,
  handleListVoices,
  handleSTTTranscribe,
  handleSaveProviderConfig,
  handleSetDefaultPersona,
  handleStartVoiceSession,
  handleTTSHealth,
  handleTTSStop,
  handleTTSSynthesize,
  handleTTSSynthesizeAlias,
  handleTestWakeWord,
  handleUnbindPersona,
  handleUpdatePersona,
  handleUpdateVoiceSettings,
  handleVoiceHealth,
  handleVoiceStream,
  handleVoiceUpload,
  handleWakeStart,
  handleWakeStatus,
  handleWakeStop,
} from '../voice-handlers';

/**
 * dispatchTaskAgentRoutes — task-agent-routes 领域路由分发
 * @returns true 表示已匹配并处理，false 表示未匹配
 */
export async function dispatchTaskAgentRoutes(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: string,
  broadcastEvent: (event: string, data: unknown) => void,
  handlerCtx: HandlerCtx
): Promise<boolean> {
  const method = req.method || 'GET';
  // ---- Tasks (长程任务中心) ----
  if (method === 'GET' && url === '/v1/tasks') {
    await handleListTasks(req, res);
    return true;
  }
  if (method === 'POST' && url.match(/^\/v1\/tasks\/(.+)\/cancel$/)) {
    await handleCancelTask(
      req,
      res,
      url.match(/^\/v1\/tasks\/(.+)\/cancel$/)![1]
    );
    return true;
  }
  if (method === 'DELETE' && url.match(/^\/v1\/tasks\/(.+)$/)) {
    await handleRemoveTask(req, res, url.match(/^\/v1\/tasks\/(.+)$/)![1]);
    return true;
  }

  // ---- Agent ----
  if (method === 'GET' && url === '/v1/agents/tasks') {
    await handleListAgentTasks(handlerCtx, req, res);
    return true;
  }
  if (method === 'POST' && url === '/v1/agents/tasks') {
    await handleExecuteAgentTask(handlerCtx, req, res);
    return true;
  }
  if (method === 'GET' && url.match(/^\/v1\/agents\/tasks\/([^/]+)$/)) {
    await handleGetAgentProgress(
      handlerCtx,
      req,
      res,
      url.match(/^\/v1\/agents\/tasks\/([^/]+)$/)![1]
    );
    return true;
  }
  if (method === 'GET' && url.match(/^\/v1\/agents\/tasks\/(.+)\/state$/)) {
    await handleGetAgentTaskState(
      handlerCtx,
      req,
      res,
      url.match(/^\/v1\/agents\/tasks\/(.+)\/state$/)![1]
    );
    return true;
  }
  if (method === 'GET' && url.match(/^\/v1\/agents\/tasks\/(.+)\/audit$/)) {
    await handleGetAgentTaskAudit(
      handlerCtx,
      req,
      res,
      url.match(/^\/v1\/agents\/tasks\/(.+)\/audit$/)![1]
    );
    return true;
  }
  if (method === 'GET' && url.match(/^\/v1\/agents\/tasks\/(.+)\/logs$/)) {
    await handleGetAgentTaskLogs(
      handlerCtx,
      req,
      res,
      url.match(/^\/v1\/agents\/tasks\/(.+)\/logs$/)![1]
    );
    return true;
  }
  if (method === 'GET' && url.match(/^\/v1\/agents\/tasks\/(.+)\/output$/)) {
    await handleGetAgentTaskOutput(
      handlerCtx,
      req,
      res,
      url.match(/^\/v1\/agents\/tasks\/(.+)\/output$/)![1]
    );
    return true;
  }
  if (method === 'POST' && url.match(/^\/v1\/agents\/tasks\/(.+)\/recover$/)) {
    await handleRecoverAgentTask(
      handlerCtx,
      req,
      res,
      url.match(/^\/v1\/agents\/tasks\/(.+)\/recover$/)![1]
    );
    return true;
  }
  if (method === 'POST' && url.match(/^\/v1\/agents\/tasks\/(.+)\/chat$/)) {
    await handleAgentTaskChat(
      handlerCtx,
      req,
      res,
      url.match(/^\/v1\/agents\/tasks\/(.+)\/chat$/)![1]
    );
    return true;
  }
  if (method === 'POST' && url.match(/^\/v1\/agents\/tasks\/(.+)\/cancel$/)) {
    await handleCancelAgentTask(
      handlerCtx,
      req,
      res,
      url.match(/^\/v1\/agents\/tasks\/(.+)\/cancel$/)![1]
    );
    return true;
  }

  // ---- Voice ----
  if (method === 'POST' && url === '/v1/voice/transcribe') {
    await handleSTTTranscribe(req, res);
    return true;
  }
  if (method === 'GET' && url === '/v1/voice/settings') {
    await handleGetVoiceSettings(req, res);
    return true;
  }
  if (method === 'PUT' && url === '/v1/voice/settings') {
    await handleUpdateVoiceSettings(req, res);
    return true;
  }
  if (method === 'POST' && url === '/v1/voice/session/start') {
    await handleStartVoiceSession(req, res);
    return true;
  }
  if (method === 'POST' && url.match(/^\/v1\/voice\/session\/(.+)\/end$/)) {
    await handleEndVoiceSession(
      req,
      res,
      url.match(/^\/v1\/voice\/session\/(.+)\/end$/)![1]
    );
    return true;
  }
  if (method === 'GET' && url === '/v1/voice/sessions') {
    await handleListVoiceSessions(req, res);
    return true;
  }
  if (method === 'GET' && url.match(/^\/v1\/voice\/session\/(.+)$/)) {
    await handleGetVoiceSession(
      req,
      res,
      url.match(/^\/v1\/voice\/session\/(.+)$/)![1]
    );
    return true;
  }
  if (method === 'POST' && url === '/v1/voice/upload') {
    await handleVoiceUpload(req, res);
    return true;
  }
  if (method === 'GET' && url.match(/^\/v1\/voice\/stream\/(.+)$/)) {
    await handleVoiceStream(
      req,
      res,
      url.match(/^\/v1\/voice\/stream\/(.+)$/)![1]
    );
    return true;
  }
  if (method === 'POST' && url === '/v1/voice/tts') {
    await handleTTSSynthesize(req, res);
    return true;
  }
  if (method === 'GET' && url === '/v1/voice/providers') {
    await handleListVoiceProviders(req, res);
    return true;
  }
  if (method === 'GET' && url === '/v1/voice/health') {
    await handleVoiceHealth(req, res);
    return true;
  }
  if (method === 'GET' && url === '/v1/voice/voices') {
    await handleListVoices(req, res);
    return true;
  }
  if (method === 'POST' && url.match(/^\/v1\/voice\/wakeword\/(.+)\/test$/)) {
    await handleTestWakeWord(
      req,
      res,
      url.match(/^\/v1\/voice\/wakeword\/(.+)\/test$/)![1]
    );
    return true;
  }
  if (method === 'POST' && url === '/v1/voice/wake/start') {
    await handleWakeStart(req, res);
    return true;
  }
  if (method === 'POST' && url === '/v1/voice/wake/stop') {
    await handleWakeStop(req, res);
    return true;
  }
  if (method === 'GET' && url === '/v1/voice/wake/status') {
    await handleWakeStatus(req, res);
    return true;
  }

  // ---- TTS Providers ----
  if (method === 'GET' && url === '/v1/tts/providers') {
    await handleListTTSProviders(req, res);
    return true;
  }
  if (
    method === 'POST' &&
    url.match(/^\/v1\/tts\/providers\/([^/]+)\/config$/)
  ) {
    await handleSaveProviderConfig(
      req,
      res,
      url.match(/^\/v1\/tts\/providers\/([^/]+)\/config$/)![1]
    );
    return true;
  }

  // ---- TTS Personas ----
  if (method === 'GET' && url === '/v1/tts/personas') {
    await handleListPersonas(req, res);
    return true;
  }
  if (method === 'POST' && url === '/v1/tts/personas') {
    await handleCreatePersona(req, res);
    return true;
  }

  // 特定路径必须在泛匹配 /v1/tts/personas/([^/]+) 之前检查，避免被泛匹配拦截
  if (method === 'GET' && url === '/v1/tts/personas/default') {
    await handleGetDefaultPersona(req, res);
    return true;
  }
  if (method === 'GET' && url === '/v1/tts/personas/bindings') {
    await handleListPersonaBindings(req, res);
    return true;
  }

  if (method === 'GET' && url.match(/^\/v1\/tts\/personas\/([^/]+)$/)) {
    await handleGetPersona(
      req,
      res,
      url.match(/^\/v1\/tts\/personas\/([^/]+)$/)![1]
    );
    return true;
  }
  if (method === 'PUT' && url.match(/^\/v1\/tts\/personas\/([^/]+)$/)) {
    await handleUpdatePersona(
      req,
      res,
      url.match(/^\/v1\/tts\/personas\/([^/]+)$/)![1]
    );
    return true;
  }
  if (method === 'DELETE' && url.match(/^\/v1\/tts\/personas\/([^/]+)$/)) {
    await handleDeletePersona(
      req,
      res,
      url.match(/^\/v1\/tts\/personas\/([^/]+)$/)![1]
    );
    return true;
  }

  // ---- TTS Additional Endpoints ----
  if (method === 'POST' && url === '/v1/tts/synthesize') {
    await handleTTSSynthesizeAlias(req, res);
    return true;
  }
  if (method === 'POST' && url === '/v1/tts/stop') {
    await handleTTSStop(req, res);
    return true;
  }
  if (method === 'GET' && url === '/v1/tts/health') {
    await handleTTSHealth(req, res);
    return true;
  }
  if (
    method === 'PUT' &&
    url.match(/^\/v1\/tts\/personas\/([^/]+)\/default$/)
  ) {
    await handleSetDefaultPersona(
      req,
      res,
      url.match(/^\/v1\/tts\/personas\/([^/]+)\/default$/)![1]
    );
    return true;
  }
  if (method === 'PUT' && url.match(/^\/v1\/tts\/personas\/([^/]+)\/bind$/)) {
    await handleBindPersona(
      req,
      res,
      url.match(/^\/v1\/tts\/personas\/([^/]+)\/bind$/)![1]
    );
    return true;
  }
  if (
    method === 'DELETE' &&
    url.match(/^\/v1\/tts\/personas\/([^/]+)\/bind$/)
  ) {
    await handleUnbindPersona(
      req,
      res,
      url.match(/^\/v1\/tts\/personas\/([^/]+)\/bind$/)![1]
    );
    return true;
  }
  return false;
}
