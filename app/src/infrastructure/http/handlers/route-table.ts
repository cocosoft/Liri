/**
 * 路由注册表
 * 将 HTTP 请求的 method + URL 匹配到对应的 handler 函数
 * 由 LocalHTTPService.handleRequest 调用
 */

import type http from 'http';
import { tryHandleRoute } from '@modules/ai';
import { Logger, LogLevel } from '@modules/monitoring';
import type { HandlerCtx } from './handler-utils';

const logger = new Logger({ module: 'http:route-table', level: LogLevel.INFO });

// Voice handlers（直接函数调用，不使用 this.handleXxx）
import {
  handleSTTTranscribe,
  handleGetVoiceSettings,
  handleUpdateVoiceSettings,
  handleStartVoiceSession,
  handleEndVoiceSession,
  handleListVoiceSessions,
  handleGetVoiceSession,
  handleVoiceUpload,
  handleVoiceStream,
  handleTTSSynthesize,
  handleListVoiceProviders,
  handleListVoices,
  handleTestWakeWord,
  handleWakeStart,
  handleWakeStop,
  handleWakeStatus,
  handleListTTSProviders,
  handleSaveProviderConfig,
  handleListPersonas,
  handleCreatePersona,
  handleGetPersona,
  handleUpdatePersona,
  handleDeletePersona,
  handleTTSSynthesizeAlias,
  handleTTSStop,
  handleTTSHealth,
  handleSetDefaultPersona,
  handleGetDefaultPersona,
  handleListPersonaBindings,
  handleBindPersona,
  handleUnbindPersona,
} from './voice-handlers';

// Cron handlers（直接函数调用，部分需要 broadcastEvent 回调）
import {
  handleListCron,
  handleCreateCron,
  handleGetCron,
  handleUpdateCron,
  handleDeleteCron,
  handleRunCron,
  handleCronStatus,
  handleCronRuns,
} from './cron-handlers';

// Inbox handlers
import {
  handleListInbox,
  handleInboxCount,
  handleGetInbox,
  handleReplyInbox,
} from './inbox-handlers';
import { handleUndoApproval } from './inbox-handlers';

// Notification handlers
import {
  handleListNotifications,
  handleUnreadCount,
  handleSearchNotifications,
  handleMarkRead,
  handleReadAll,
  handleDismiss,
  handleBatch,
  handleDeleteNotification,
  handleNotificationAction,
  handleCreateNotification,
} from './notification-handlers';

// Steering handler (Phase 3)
import { handleSteerSession } from './steer-handlers';

// Channel handlers（直接函数调用，部分需要 broadcastEvent 回调）
import {
  handleListChannels,
  handleGetChannel,
  handleToggleChannel,
  handleDeleteChannel,
  handleUpdateChannel,
  handleApplyChannelConfig,
} from './channel-handlers';

// Channel plugin handlers（直接函数调用）
import { handleUninstallChannelPlugin } from './channel-plugin-handlers';

// Trace handlers（直接函数调用）
import { handleTraceStats } from './trace-handlers';

// Agent role handlers（直接函数调用）
import {
  handleListAgentRoles,
  handleGetAgentRole,
  handleCreateAgentRole,
  handleUpdateAgentRole,
  handleDeleteAgentRole,
} from './agent-role-handlers';

// Security handlers（直接函数调用）
import {
  handleSecurityDashboard,
  handleQueryAuditLogs,
} from './security-handlers';

// Auth handlers（直接函数调用）
import {
  handleAuthLogin,
  handleAuthRegister,
  handleAuthLogout,
  handleAuthMe,
  handleAuthPermissions,
} from './auth-handlers';

// Media handlers
import {
  handleMediaSubtitleGenerate,
  handleMediaSubtitleDownload,
} from './media-handlers';

/**
 * 路由调度函数
 * @param req - HTTP 请求
 * @param res - HTTP 响应
 * @param url - 解析后的 URL path
 * @param self - LocalHTTPService 实例（用于调用 this.handleXxx 方法）
 * @param broadcastEvent - 事件广播回调
 * @param handlerCtx - HandlerCtx 实例（用于动态 import 的 handler）
 * @returns true 表示已匹配路由并处理，false 表示未匹配
 */
export async function dispatchRoute(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: string,
  self: Record<string, Function>,
  broadcastEvent: (event: string, data: unknown) => void,
  handlerCtx: HandlerCtx
): Promise<boolean> {
  const method = req.method || 'GET';

  // ---- SSE Event Bus ----
  if (url === '/v1/events') {
    if (req.method === 'GET') {
      await self['handleEvents'](req, res);
      return true;
    }
    // HEAD 用于心跳保活，返回 200 即可
    if (req.method === 'HEAD') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.end();
      return true;
    }
  }

  // ---- Chat ----
  if (method === 'POST' && url === '/v1/chat/completions') {
    await self['handleChatCompletions'](req, res);
    return true;
  }
  if (method === 'POST' && url === '/v1/chat/question-answer') {
    await self['handleQuestionAnswer'](req, res);
    return true;
  }

  // ---- Session ----
  if (method === 'GET' && url === '/v1/sessions') {
    await self['handleListSessions'](req, res);
    return true;
  }
  if (method === 'POST' && url === '/v1/sessions') {
    await self['handleCreateSession'](req, res);
    return true;
  }
  if (method === 'GET' && url === '/v1/sessions/current') {
    await self['handleGetCurrentSession'](req, res);
    return true;
  }
  if (method === 'GET' && url.match(/^\/v1\/sessions\/(.+)\/messages$/)) {
    await self['handleGetSessionMessages'](
      req,
      res,
      url.match(/^\/v1\/sessions\/(.+)\/messages$/)![1]
    );
    return true;
  }
  if (
    method === 'DELETE' &&
    url.match(/^\/v1\/sessions\/(.+)\/messages\/(.+)$/)
  ) {
    const match = url.match(/^\/v1\/sessions\/(.+)\/messages\/(.+)$/);
    await self['handleDeleteMessage'](req, res, match![1], match![2]);
    return true;
  }
  if (
    method === 'POST' &&
    url.match(/^\/v1\/sessions\/(.+)\/messages\/truncate$/)
  ) {
    const match = url.match(/^\/v1\/sessions\/(.+)\/messages\/truncate$/);
    await self['handleTruncateMessages'](req, res, match![1]);
    return true;
  }
  if (
    method === 'PUT' &&
    url.match(/^\/api\/session\/(.+)\/message\/(.+)\/blocks$/)
  ) {
    const match = url.match(/^\/api\/session\/(.+)\/message\/(.+)\/blocks$/);
    await self['handleUpdateMessageBlocks'](req, res, match![1], match![2]);
    return true;
  }
  if (method === 'GET' && url.match(/^\/v1\/sessions\/(.+)$/)) {
    await self['handleGetSession'](
      req,
      res,
      url.match(/^\/v1\/sessions\/(.+)$/)![1]
    );
    return true;
  }
  if (method === 'POST' && url.match(/^\/v1\/sessions\/(.+)\/switch$/)) {
    await self['handleSwitchSession'](
      req,
      res,
      url.match(/^\/v1\/sessions\/(.+)\/switch$/)![1]
    );
    return true;
  }
  if (method === 'PUT' && url.match(/^\/v1\/sessions\/(.+)$/)) {
    await self['handleRenameSession'](
      req,
      res,
      url.match(/^\/v1\/sessions\/(.+)$/)![1]
    );
    return true;
  }
  if (method === 'POST' && url.match(/^\/v1\/sessions\/(.+)\/title$/)) {
    await self['handleGenerateTitle'](
      req,
      res,
      url.match(/^\/v1\/sessions\/(.+)\/title$/)![1]
    );
    return true;
  }
  if (method === 'PATCH' && url.match(/^\/v1\/sessions\/(.+)\/meta$/)) {
    await self['handleUpdateSessionMeta'](
      req,
      res,
      url.match(/^\/v1\/sessions\/(.+)\/meta$/)![1]
    );
    return true;
  }
  if (method === 'POST' && url.match(/^\/v1\/sessions\/(.+)\/compact$/)) {
    await self['handleCompactSession'](
      req,
      res,
      url.match(/^\/v1\/sessions\/(.+)\/compact$/)![1]
    );
    return true;
  }
  if (method === 'POST' && url.match(/^\/v1\/sessions\/(.+)\/prune$/)) {
    await self['handlePruneSession'](
      req,
      res,
      url.match(/^\/v1\/sessions\/(.+)\/prune$/)![1]
    );
    return true;
  }
  if (method === 'GET' && url.match(/^\/v1\/sessions\/(.+)\/memory$/)) {
    await self['handleGetSessionMemory'](
      req,
      res,
      url.match(/^\/v1\/sessions\/(.+)\/memory$/)![1]
    );
    return true;
  }
  if (method === 'DELETE' && url.match(/^\/v1\/sessions\/(.+)$/)) {
    await self['handleDeleteSession'](
      req,
      res,
      url.match(/^\/v1\/sessions\/(.+)$/)![1]
    );
    return true;
  }
  if (method === 'DELETE' && url === '/v1/sessions') {
    await self['handleClearAllSessions'](req, res);
    return true;
  }

  // ---- Steering (Phase 3) ----
  if (method === 'POST' && url.match(/^\/v1\/sessions\/(.+)\/steer$/)) {
    const sid = url.match(/^\/v1\/sessions\/(.+)\/steer$/)![1];
    await handleSteerSession(req, res, handlerCtx, sid);
    return true;
  }

  // ---- Plans & Flows (编排) ----
  if (method === 'GET' && url === '/v1/plans') {
    await self['handleListPlans'](req, res);
    return true;
  }
  if (method === 'POST' && url === '/v1/plans') {
    await self['handleCreatePlan'](req, res);
    return true;
  }
  if (method === 'GET' && url.match(/^\/v1\/plans\/([^/]+)$/)) {
    await self['handleGetPlan'](
      req,
      res,
      url.match(/^\/v1\/plans\/([^/]+)$/)![1]
    );
    return true;
  }
  if (method === 'POST' && url.match(/^\/v1\/plans\/(.+)\/execute$/)) {
    await self['handleExecutePlan'](
      req,
      res,
      url.match(/^\/v1\/plans\/(.+)\/execute$/)![1]
    );
    return true;
  }
  if (method === 'POST' && url.match(/^\/v1\/plans\/(.+)\/abort$/)) {
    await self['handleAbortPlan'](
      req,
      res,
      url.match(/^\/v1\/plans\/(.+)\/abort$/)![1]
    );
    return true;
  }
  if (method === 'GET' && url === '/v1/flows') {
    await self['handleListFlows'](req, res);
    return true;
  }
  if (method === 'GET' && url.match(/^\/v1\/flows\/([^/]+)$/)) {
    await self['handleGetFlow'](
      req,
      res,
      url.match(/^\/v1\/flows\/([^/]+)$/)![1]
    );
    return true;
  }

  // ---- PDCA (长程任务编排) ----
  if (method === 'POST' && url === '/v1/pdca/start') {
    await self['handlePdcaStart'](req, res);
    return true;
  }
  if (method === 'GET' && url.match(/^\/v1\/pdca\/([^/]+)$/)) {
    await self['handlePdcaStatus'](
      req,
      res,
      url.match(/^\/v1\/pdca\/([^/]+)$/)![1]
    );
    return true;
  }
  if (method === 'GET' && url.match(/^\/v1\/pdca\/(.+)\/audit$/)) {
    await self['handlePdcaAudit'](
      req,
      res,
      url.match(/^\/v1\/pdca\/(.+)\/audit$/)![1]
    );
    return true;
  }
  if (method === 'POST' && url.match(/^\/v1\/pdca\/(.+)\/confirm$/)) {
    await self['handlePdcaConfirm'](
      req,
      res,
      url.match(/^\/v1\/pdca\/(.+)\/confirm$/)![1]
    );
    return true;
  }
  if (
    method === 'POST' &&
    url.match(/^\/v1\/pdca\/(.+)\/step\/(.+)\/review$/)
  ) {
    const m = url.match(/^\/v1\/pdca\/(.+)\/step\/(.+)\/review$/)!;
    await self['handlePdcaReviewStep'](req, res, m[1], m[2]);
    return true;
  }
  if (
    method === 'POST' &&
    url.match(/^\/v1\/pdca\/(.+)\/step\/(.+)\/decide$/)
  ) {
    const m = url.match(/^\/v1\/pdca\/(.+)\/step\/(.+)\/decide$/)!;
    await self['handlePdcaDecideStep'](req, res, m[1], m[2]);
    return true;
  }
  if (method === 'POST' && url === '/v1/pdca/list') {
    await self['handlePdcaList'](req, res);
    return true;
  }

  // ---- Kanban ----
  if (method === 'GET' && url === '/v1/kanban') {
    await self['handleKanbanList'](req, res);
    return true;
  }
  if (method === 'POST' && url === '/v1/kanban') {
    await self['handleKanbanCreate'](req, res);
    return true;
  }
  if (method === 'PUT' && url.match(/^\/v1\/kanban\/(.+)$/)) {
    await self['handleKanbanUpdate'](
      req,
      res,
      url.match(/^\/v1\/kanban\/(.+)$/)![1]
    );
    return true;
  }
  if (method === 'DELETE' && url.match(/^\/v1\/kanban\/(.+)$/)) {
    await self['handleKanbanDelete'](
      req,
      res,
      url.match(/^\/v1\/kanban\/(.+)$/)![1]
    );
    return true;
  }
  if (method === 'PUT' && url.match(/^\/v1\/kanban\/(.+)\/move$/)) {
    await self['handleKanbanMove'](
      req,
      res,
      url.match(/^\/v1\/kanban\/(.+)\/move$/)![1]
    );
    return true;
  }

  // ---- Tools ----
  if (method === 'GET' && url === '/v1/tools') {
    await self['handleListTools'](req, res);
    return true;
  }
  if (method === 'POST' && url.match(/^\/v1\/tools\/(.+)\/execute$/)) {
    await self['handleExecuteTool'](
      req,
      res,
      url.match(/^\/v1\/tools\/(.+)\/execute$/)![1]
    );
    return true;
  }

  // ---- Images ----
  if (method === 'GET' && url === '/v1/images/list') {
    await self['handleImageList'](req, res);
    return true;
  }
  if (method === 'GET' && url.startsWith('/v1/images/metadata')) {
    await self['handleImageMetadata'](req, res);
    return true;
  }
  if (method === 'GET' && url.startsWith('/v1/images/static/')) {
    const filePath = url.slice('/v1/images/static/'.length);
    await self['handleImageStatic'](req, res, decodeURIComponent(filePath));
    return true;
  }
  if (method === 'POST' && url === '/v1/images/upload') {
    await self['handleImageUpload'](req, res);
    return true;
  }
  if (method === 'DELETE' && url.startsWith('/v1/images/delete')) {
    await self['handleImageDelete'](req, res);
    return true;
  }

  // ---- Videos ----
  if (method === 'GET' && url === '/v1/videos/list') {
    await self['handleVideoList'](req, res);
    return true;
  }
  if (method === 'GET' && url.startsWith('/v1/videos/metadata')) {
    await self['handleVideoMetadata'](req, res);
    return true;
  }
  if (method === 'GET' && url.startsWith('/v1/videos/by-source-image')) {
    await self['handleVideoBySourceImage'](req, res);
    return true;
  }
  if (method === 'GET' && url.startsWith('/v1/videos/static/')) {
    const filePath = url.slice('/v1/videos/static/'.length);
    await self['handleVideoStatic'](req, res, decodeURIComponent(filePath));
    return true;
  }
  if (method === 'DELETE' && url.startsWith('/v1/videos/delete')) {
    await self['handleVideoDelete'](req, res);
    return true;
  }

  // ---- Audio ----
  if (method === 'GET' && url.startsWith('/v1/audio/static/')) {
    const filePath = url.slice('/v1/audio/static/'.length);
    await self['handleAudioStatic'](req, res, decodeURIComponent(filePath));
    return true;
  }

  // ---- Media ----
  if (url.startsWith('/v1/media')) {
    await self['handleMedia'](req, res);
    return true;
  }

  // ---- Video Tasks (async) ----
  if (url.startsWith('/v1/video/tasks')) {
    await self['handleVideoTasks'](req, res);
    return true;
  }

  // ---- Agent ----
  if (method === 'GET' && url === '/v1/agents/tasks') {
    await self['handleListAgentTasks'](req, res);
    return true;
  }
  if (method === 'POST' && url === '/v1/agents/tasks') {
    await self['handleExecuteAgentTask'](req, res);
    return true;
  }
  if (method === 'GET' && url.match(/^\/v1\/agents\/tasks\/([^/]+)$/)) {
    await self['handleGetAgentProgress'](
      req,
      res,
      url.match(/^\/v1\/agents\/tasks\/([^/]+)$/)![1]
    );
    return true;
  }
  if (method === 'GET' && url.match(/^\/v1\/agents\/tasks\/(.+)\/state$/)) {
    await self['handleGetAgentTaskState'](
      req,
      res,
      url.match(/^\/v1\/agents\/tasks\/(.+)\/state$/)![1]
    );
    return true;
  }
  if (method === 'GET' && url.match(/^\/v1\/agents\/tasks\/(.+)\/audit$/)) {
    await self['handleGetAgentTaskAudit'](
      req,
      res,
      url.match(/^\/v1\/agents\/tasks\/(.+)\/audit$/)![1]
    );
    return true;
  }
  if (method === 'GET' && url.match(/^\/v1\/agents\/tasks\/(.+)\/logs$/)) {
    await self['handleGetAgentTaskLogs'](
      req,
      res,
      url.match(/^\/v1\/agents\/tasks\/(.+)\/logs$/)![1]
    );
    return true;
  }
  if (method === 'GET' && url.match(/^\/v1\/agents\/tasks\/(.+)\/output$/)) {
    await self['handleGetAgentTaskOutput'](
      req,
      res,
      url.match(/^\/v1\/agents\/tasks\/(.+)\/output$/)![1]
    );
    return true;
  }
  if (method === 'POST' && url.match(/^\/v1\/agents\/tasks\/(.+)\/recover$/)) {
    await self['handleRecoverAgentTask'](
      req,
      res,
      url.match(/^\/v1\/agents\/tasks\/(.+)\/recover$/)![1]
    );
    return true;
  }
  if (method === 'POST' && url.match(/^\/v1\/agents\/tasks\/(.+)\/chat$/)) {
    await self['handleAgentTaskChat'](
      req,
      res,
      url.match(/^\/v1\/agents\/tasks\/(.+)\/chat$/)![1]
    );
    return true;
  }
  if (method === 'POST' && url.match(/^\/v1\/agents\/tasks\/(.+)\/cancel$/)) {
    await self['handleCancelAgentTask'](
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

  // ---- Checkpoints ----
  if (method === 'POST' && url === '/v1/checkpoints') {
    await self['handleCreateCheckpoint'](req, res);
    return true;
  }
  if (method === 'GET' && url === '/v1/checkpoints') {
    await self['handleListCheckpoints'](req, res);
    return true;
  }
  if (method === 'GET' && url.match(/^\/v1\/checkpoints\/(.+)$/)) {
    await self['handleGetCheckpoint'](
      req,
      res,
      url.match(/^\/v1\/checkpoints\/(.+)$/)![1]
    );
    return true;
  }
  if (method === 'POST' && url.match(/^\/v1\/checkpoints\/(.+)\/rollback$/)) {
    await self['handleRollbackCheckpoint'](
      req,
      res,
      url.match(/^\/v1\/checkpoints\/(.+)\/rollback$/)![1]
    );
    return true;
  }
  if (method === 'DELETE' && url.match(/^\/v1\/checkpoints\/(.+)$/)) {
    await self['handleDeleteCheckpoint'](
      req,
      res,
      url.match(/^\/v1\/checkpoints\/(.+)$/)![1]
    );
    return true;
  }

  // ---- Memory ----
  if (method === 'POST' && url === '/v1/memory') {
    await self['handleCreateMemory'](req, res);
    return true;
  }
  if (method === 'GET' && url === '/v1/memory') {
    await self['handleListMemories'](req, res);
    return true;
  }
  if (method === 'GET' && url === '/v1/memory/search') {
    await self['handleSearchMemories'](req, res);
    return true;
  }
  if (method === 'GET' && url === '/v1/memory/weights') {
    await self['handleGetMemoryWeights'](req, res);
    return true;
  }
  if (method === 'GET' && url === '/v1/memory/sync-status') {
    await self['handleGetSyncStatus'](req, res);
    return true;
  }
  if (method === 'GET' && url === '/v1/memory/stats') {
    await self['handleGetStats'](req, res);
    return true;
  }
  if (method === 'GET' && url.match(/^\/v1\/memory\/(.+)\/summary$/)) {
    await self['handleGetMemorySummary'](
      req,
      res,
      url.match(/^\/v1\/memory\/(.+)\/summary$/)![1]
    );
    return true;
  }
  if (method === 'GET' && url.match(/^\/v1\/memory\/([^/]+)$/)) {
    await self['handleGetMemory'](
      req,
      res,
      url.match(/^\/v1\/memory\/([^/]+)$/)![1]
    );
    return true;
  }
  if (method === 'POST' && url === '/v1/memory') {
    await self['handleCreateMemory'](req, res);
    return true;
  }
  if (method === 'POST' && url === '/v1/memory/sync') {
    await self['handleSyncMemories'](req, res);
    return true;
  }
  if (method === 'POST' && url === '/v1/memory/consolidate') {
    await self['handleConsolidateMemories'](req, res);
    return true;
  }
  if (method === 'POST' && url === '/v1/memory/dream') {
    await self['handleDreamMemories'](req, res);
    return true;
  }
  if (method === 'GET' && url === '/v1/memory/dream/cycles') {
    await self['handleDreamCyclesList'](req, res);
    return true;
  }
  const cycleDetailMatch =
    method === 'GET' && url.match(/^\/v1\/memory\/dream\/cycles\/(dream_\d+)$/);
  if (cycleDetailMatch) {
    await self['handleDreamCycleDetail'](req, res, cycleDetailMatch[1]);
    return true;
  }
  if (method === 'PUT' && url.match(/^\/v1\/memory\/(.+)$/)) {
    await self['handleUpdateMemory'](
      req,
      res,
      url.match(/^\/v1\/memory\/(.+)$/)![1]
    );
    return true;
  }
  if (method === 'DELETE' && url === '/v1/memory') {
    await self['handleDeleteAllMemories'](req, res);
    return true;
  }
  if (method === 'DELETE' && url.match(/^\/v1\/memory\/(.+)$/)) {
    await self['handleDeleteMemory'](
      req,
      res,
      url.match(/^\/v1\/memory\/(.+)$/)![1]
    );
    return true;
  }

  // ---- Semantic Index ----
  if (method === 'POST' && url === '/v1/semantic/index') {
    await self['handleBuildSemanticIndex'](req, res);
    return true;
  }
  if (method === 'GET' && url === '/v1/semantic/search') {
    await self['handleSearchSemantic'](req, res);
    return true;
  }
  if (method === 'GET' && url === '/v1/semantic/index/status') {
    await self['handleGetSemanticIndexStatus'](req, res);
    return true;
  }
  if (method === 'DELETE' && url === '/v1/semantic/index') {
    await self['handleClearSemanticIndex'](req, res);
    return true;
  }

  // ---- Files ----
  if (method === 'GET' && url === '/v1/files/list') {
    const { handleFileList } = await import('./files-handlers');
    await handleFileList(handlerCtx, req, res);
    return true;
  }
  if (method === 'GET' && url === '/v1/files/read') {
    const { handleFileRead } = await import('./files-handlers');
    await handleFileRead(handlerCtx, req, res);
    return true;
  }
  if (method === 'POST' && url === '/v1/files/upload') {
    await self['handleFileUpload'](req, res);
    return true;
  }
  if (method === 'POST' && url === '/v1/files/convert') {
    await self['handleConvertFile'](req, res);
    return true;
  }
  if (method === 'POST' && url === '/v1/files/detect') {
    await self['handleDetectFileType'](req, res);
    return true;
  }
  if (method === 'POST' && url === '/v1/files/send-to-ai') {
    await self['handleSendFileToAI'](req, res);
    return true;
  }

  // ---- Files: Registry API ----
  if (method === 'GET' && url === '/v1/files/health') {
    await self['handleFileHealth'](req, res);
    return true;
  }
  if (method === 'GET' && url === '/v1/files/registry/list') {
    await self['handleFileRegistryList'](req, res);
    return true;
  }
  if (method === 'GET' && url === '/v1/files/registry/detail') {
    await self['handleFileRegistryDetail'](req, res);
    return true;
  }
  if (method === 'GET' && url === '/v1/files/registry/search') {
    await self['handleFileRegistrySearch'](req, res);
    return true;
  }
  if (method === 'GET' && url === '/v1/files/registry/stats') {
    await self['handleFileRegistryStats'](req, res);
    return true;
  }
  if (method === 'DELETE' && url === '/v1/files/registry/delete') {
    await self['handleFileRegistryDelete'](req, res);
    return true;
  }

  // ---- Workspaces ----
  if (method === 'GET' && url === '/v1/workspaces') {
    await self['handleListWorkspaces'](req, res);
    return true;
  }

  // ---- Workspace Sessions ----
  if (method === 'GET' && url.match(/^\/v1\/workspaces\/(.+)\/sessions$/)) {
    const workspaceId = url.match(/^\/v1\/workspaces\/(.+)\/sessions$/)![1];
    await self['handleListWorkspaceSessions'](req, res, workspaceId);
    return true;
  }
  if (method === 'POST' && url.match(/^\/v1\/workspaces\/(.+)\/sessions$/)) {
    const workspaceId = url.match(/^\/v1\/workspaces\/(.+)\/sessions$/)![1];
    await self['handleCreateWorkspaceSession'](req, res, workspaceId);
    return true;
  }

  // ---- Work Items ----
  if (method === 'GET' && url.match(/^\/v1\/workspaces\/(.+)\/items$/)) {
    const workspaceId = url.match(/^\/v1\/workspaces\/(.+)\/items$/)![1];
    await self['handleListWorkItems'](req, res, workspaceId);
    return true;
  }
  if (method === 'POST' && url.match(/^\/v1\/workspaces\/(.+)\/items$/)) {
    const workspaceId = url.match(/^\/v1\/workspaces\/(.+)\/items$/)![1];
    await self['handleCreateWorkItem'](req, res, workspaceId);
    return true;
  }
  if (
    method === 'PATCH' &&
    url.match(/^\/v1\/workspaces\/(.+)\/items\/(.+)$/)
  ) {
    const match = url.match(/^\/v1\/workspaces\/(.+)\/items\/(.+)$/);
    const workspaceId = match![1];
    const itemId = match![2];
    await self['handleUpdateWorkItem'](req, res, workspaceId, itemId);
    return true;
  }

  // ---- .liri/ Config ----
  if (method === 'GET' && url.match(/^\/v1\/workspaces\/(.+)\/liri\/detect$/)) {
    const workspaceId = url.match(/^\/v1\/workspaces\/(.+)\/liri\/detect$/)![1];
    await self['handleDetectLiriDir'](req, res, workspaceId);
    return true;
  }
  if (method === 'POST' && url.match(/^\/v1\/workspaces\/(.+)\/liri\/init$/)) {
    const workspaceId = url.match(/^\/v1\/workspaces\/(.+)\/liri\/init$/)![1];
    await self['handleInitLiriDir'](req, res, workspaceId);
    return true;
  }
  if (method === 'GET' && url.match(/^\/v1\/workspaces\/(.+)\/config$/)) {
    const workspaceId = url.match(/^\/v1\/workspaces\/(.+)\/config$/)![1];
    await self['handleGetWorkspaceConfig'](req, res, workspaceId);
    return true;
  }
  if (method === 'PUT' && url.match(/^\/v1\/workspaces\/(.+)\/config$/)) {
    const workspaceId = url.match(/^\/v1\/workspaces\/(.+)\/config$/)![1];
    await self['handleUpdateWorkspaceConfig'](req, res, workspaceId);
    return true;
  }
  if (method === 'GET' && url.match(/^\/v1\/workspaces\/(.+)\/rules$/)) {
    const workspaceId = url.match(/^\/v1\/workspaces\/(.+)\/rules$/)![1];
    await self['handleGetWorkspaceRules'](req, res, workspaceId);
    return true;
  }
  if (method === 'PUT' && url.match(/^\/v1\/workspaces\/(.+)\/rules$/)) {
    const workspaceId = url.match(/^\/v1\/workspaces\/(.+)\/rules$/)![1];
    await self['handleUpdateWorkspaceRules'](req, res, workspaceId);
    return true;
  }

  // ---- .liri/ Changesets ----
  if (
    method === 'GET' &&
    url.match(/^\/v1\/workspaces\/(.+)\/items\/(.+)\/changesets$/)
  ) {
    const match = url.match(
      /^\/v1\/workspaces\/(.+)\/items\/(.+)\/changesets$/
    )!;
    await self['handleListChangeSets'](req, res, match[1], match[2]);
    return true;
  }
  if (
    method === 'POST' &&
    url.match(/^\/v1\/workspaces\/(.+)\/items\/(.+)\/changesets$/)
  ) {
    const match = url.match(
      /^\/v1\/workspaces\/(.+)\/items\/(.+)\/changesets$/
    )!;
    await self['handleCreateChangeSet'](req, res, match[1], match[2]);
    return true;
  }
  if (
    method === 'GET' &&
    url.match(/^\/v1\/workspaces\/(.+)\/changesets\/(.+)\/summary$/)
  ) {
    const match = url.match(
      /^\/v1\/workspaces\/(.+)\/changesets\/(.+)\/summary$/
    )!;
    await self['handleGetChangeSetSummary'](req, res, match[1], match[2]);
    return true;
  }
  if (
    method === 'GET' &&
    url.match(/^\/v1\/workspaces\/(.+)\/changesets\/(.+)$/)
  ) {
    const match = url.match(/^\/v1\/workspaces\/(.+)\/changesets\/(.+)$/)!;
    await self['handleGetChangeSet'](req, res, match[1], match[2]);
    return true;
  }
  if (
    method === 'POST' &&
    url.match(/^\/v1\/workspaces\/(.+)\/changesets\/(.+)\/files$/)
  ) {
    const match = url.match(
      /^\/v1\/workspaces\/(.+)\/changesets\/(.+)\/files$/
    )!;
    await self['handleAddFileChange'](req, res, match[1], match[2]);
    return true;
  }
  if (
    method === 'PATCH' &&
    url.match(/^\/v1\/workspaces\/(.+)\/changesets\/(.+)$/)
  ) {
    const match = url.match(/^\/v1\/workspaces\/(.+)\/changesets\/(.+)$/)!;
    await self['handleUpdateChangeSet'](req, res, match[1], match[2]);
    return true;
  }

  // ---- Projects ----
  if (method === 'GET' && url.match(/^\/v1\/workspaces\/(.+)\/projects$/)) {
    const workspaceId = url.match(/^\/v1\/workspaces\/(.+)\/projects$/)![1];
    await self['handleListProjects'](req, res, workspaceId);
    return true;
  }
  if (method === 'POST' && url.match(/^\/v1\/workspaces\/(.+)\/projects$/)) {
    const workspaceId = url.match(/^\/v1\/workspaces\/(.+)\/projects$/)![1];
    await self['handleCreateProject'](req, res, workspaceId);
    return true;
  }
  if (method === 'GET' && url.match(/^\/v1\/workspaces\/(.+)\/templates$/)) {
    const workspaceId = url.match(/^\/v1\/workspaces\/(.+)\/templates$/)![1];
    await self['handleGetTemplates'](req, res, workspaceId);
    return true;
  }
  if (
    method === 'GET' &&
    url.match(/^\/v1\/workspaces\/(.+)\/projects\/(.+)\/board$/)
  ) {
    const match = url.match(/^\/v1\/workspaces\/(.+)\/projects\/(.+)\/board$/)!;
    await self['handleGetProjectBoard'](req, res, match[1], match[2]);
    return true;
  }
  if (
    method === 'GET' &&
    url.match(/^\/v1\/workspaces\/(.+)\/projects\/(.+)\/rules$/)
  ) {
    const match = url.match(/^\/v1\/workspaces\/(.+)\/projects\/(.+)\/rules$/)!;
    await self['handleGetProjectRules'](req, res, match[1], match[2]);
    return true;
  }
  if (
    method === 'PUT' &&
    url.match(/^\/v1\/workspaces\/(.+)\/projects\/(.+)\/rules$/)
  ) {
    const match = url.match(/^\/v1\/workspaces\/(.+)\/projects\/(.+)\/rules$/)!;
    await self['handleUpdateProjectRules'](req, res, match[1], match[2]);
    return true;
  }
  if (
    method === 'POST' &&
    url.match(/^\/v1\/workspaces\/(.+)\/projects\/(.+)\/items$/)
  ) {
    const match = url.match(/^\/v1\/workspaces\/(.+)\/projects\/(.+)\/items$/)!;
    await self['handleCreateProjectWorkItem'](req, res, match[1], match[2]);
    return true;
  }
  if (
    method === 'GET' &&
    url.match(/^\/v1\/workspaces\/(.+)\/projects\/(.+)$/)
  ) {
    const match = url.match(/^\/v1\/workspaces\/(.+)\/projects\/(.+)$/)!;
    await self['handleGetProject'](req, res, match[1], match[2]);
    return true;
  }
  if (
    method === 'PATCH' &&
    url.match(/^\/v1\/workspaces\/(.+)\/projects\/(.+)$/)
  ) {
    const match = url.match(/^\/v1\/workspaces\/(.+)\/projects\/(.+)$/)!;
    await self['handleUpdateProject'](req, res, match[1], match[2]);
    return true;
  }
  if (
    method === 'DELETE' &&
    url.match(/^\/v1\/workspaces\/(.+)\/projects\/(.+)$/)
  ) {
    const match = url.match(/^\/v1\/workspaces\/(.+)\/projects\/(.+)$/)!;
    await self['handleDeleteProject'](req, res, match[1], match[2]);
    return true;
  }

  // ---- Knowledge ----
  if (
    method === 'GET' &&
    url.match(/^\/v1\/workspaces\/(.+)\/items\/(.+)\/orchestration\/stream$/)
  ) {
    const match = url.match(
      /^\/v1\/workspaces\/(.+)\/items\/(.+)\/orchestration\/stream$/
    )!;
    await self['handleOrchestrationStream'](req, res, match[1], match[2]);
    return true;
  }
  if (
    method === 'GET' &&
    url.match(/^\/v1\/workspaces\/(.+)\/items\/(.+)\/orchestration\/history$/)
  ) {
    const match = url.match(
      /^\/v1\/workspaces\/(.+)\/items\/(.+)\/orchestration\/history$/
    )!;
    await self['handleGetOrchestrationHistory'](req, res, match[1], match[2]);
    return true;
  }
  if (
    method === 'GET' &&
    url.match(/^\/v1\/workspaces\/(.+)\/items\/(.+)\/orchestration$/)
  ) {
    const match = url.match(
      /^\/v1\/workspaces\/(.+)\/items\/(.+)\/orchestration$/
    )!;
    await self['handleGetOrchestrationSnapshot'](req, res, match[1], match[2]);
    return true;
  }
  if (method === 'GET' && url.match(/^\/v1\/workspaces\/(.+)\/swarm$/)) {
    const workspaceId = url.match(/^\/v1\/workspaces\/(.+)\/swarm$/)![1];
    await self['handleGetSwarmStatus'](req, res, workspaceId);
    return true;
  }
  if (
    method === 'GET' &&
    url.match(/^\/v1\/workspaces\/(.+)\/agent-model-bindings$/)
  ) {
    const workspaceId = url.match(
      /^\/v1\/workspaces\/(.+)\/agent-model-bindings$/
    )![1];
    await self['handleGetAgentModelBindings'](req, res, workspaceId);
    return true;
  }
  if (
    method === 'PUT' &&
    url.match(/^\/v1\/workspaces\/(.+)\/agent-model-bindings$/)
  ) {
    const workspaceId = url.match(
      /^\/v1\/workspaces\/(.+)\/agent-model-bindings$/
    )![1];
    await self['handleUpdateAgentModelBindings'](req, res, workspaceId);
    return true;
  }

  // ---- Knowledge ----
  if (method === 'GET' && url === '/v1/knowledge') {
    await self['handleListKnowledge'](req, res);
    return true;
  }
  if (method === 'POST' && url === '/v1/knowledge/search') {
    await self['handleSearchKnowledge'](req, res);
    return true;
  }
  if (method === 'POST' && url === '/v1/knowledge') {
    await self['handleCreateKnowledge'](req, res);
    return true;
  }
  if (method === 'GET' && url === '/v1/knowledge/bases') {
    await self['handleListKnowledgeBases'](req, res);
    return true;
  }
  if (method === 'POST' && url === '/v1/knowledge/bases') {
    await self['handleCreateKnowledgeBase'](req, res);
    return true;
  }
  if (method === 'PUT' && url.match(/^\/v1\/knowledge\/bases\/(.+)$/)) {
    await self['handleUpdateKnowledgeBase'](
      req,
      res,
      url.match(/^\/v1\/knowledge\/bases\/(.+)$/)![1]
    );
    return true;
  }
  if (method === 'DELETE' && url.match(/^\/v1\/knowledge\/bases\/(.+)$/)) {
    await self['handleDeleteKnowledgeBase'](
      req,
      res,
      url.match(/^\/v1\/knowledge\/bases\/(.+)$/)![1]
    );
    return true;
  }
  if (method === 'POST' && url.match(/^\/v1\/knowledge\/bases\/(.+)\/clone$/)) {
    await self['handleCloneKnowledgeBase'](
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
    await self['handleDuplicateKnowledgeBase'](
      req,
      res,
      url.match(/^\/v1\/knowledge\/bases\/(.+)\/duplicate$/)![1]
    );
    return true;
  }
  if (method === 'POST' && url === '/v1/knowledge/save-from-chat') {
    await self['handleSaveFromChat'](req, res);
    return true;
  }
  if (method === 'POST' && url === '/v1/knowledge/upload') {
    await self['handleKnowledgeUpload'](req, res);
    return true;
  }
  if (method === 'POST' && url === '/v1/knowledge/compile') {
    await self['handleKnowledgeCompile'](req, res);
    return true;
  }
  if (method === 'GET' && url === '/v1/knowledge/compile-status') {
    await self['handleKnowledgeCompileStatus'](req, res);
    return true;
  }
  if (method === 'GET' && url === '/v1/knowledge/raw-files') {
    await self['handleGetRawFiles'](req, res);
    return true;
  }
  if (method === 'GET' && url === '/v1/knowledge/health') {
    await self['handleKnowledgeHealth'](req, res);
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
    await self['handleListSnapshots'](req, res);
    return true;
  }
  if (method === 'POST' && url === '/v1/knowledge/restore') {
    await self['handleRestoreSnapshot'](req, res);
    return true;
  }
  if (method === 'POST' && url === '/v1/knowledge/trash') {
    await self['handleTrashKnowledge'](req, res);
    return true;
  }
  if (method === 'POST' && url === '/v1/knowledge/restore-trash') {
    await self['handleRestoreTrash'](req, res);
    return true;
  }
  if (method === 'GET' && url.startsWith('/v1/knowledge/export')) {
    await self['handleExportKnowledge'](req, res);
    return true;
  }
  if (method === 'PUT' && url === '/v1/knowledge/docs') {
    await self['handleUpdateKnowledgeDoc'](req, res);
    return true;
  }
  if (method === 'POST' && url === '/v1/knowledge/export-to-notebook') {
    await self['handleExportToNotebook'](req, res);
    return true;
  }
  if (method === 'POST' && url === '/v1/knowledge/import-from-file') {
    await self['handleImportFromFile'](req, res);
    return true;
  }
  if (method === 'POST' && url === '/v1/knowledge/ingest') {
    await self['handleImportFromFile'](req, res);
    return true;
  }
  if (method === 'POST' && url === '/v1/knowledge/batch-delete') {
    await self['handleBatchDeleteKnowledge'](req, res);
    return true;
  }
  if (method === 'POST' && url === '/v1/knowledge/batch-tag') {
    await self['handleBatchTagKnowledge'](req, res);
    return true;
  }
  // ---- FAQ ----
  if (
    method === 'GET' &&
    url.match(/^\/v1\/knowledge\/([^/]+)\/faq\/categories$/)
  ) {
    await self['handleFAQCategories'](req, res);
    return true;
  }
  if (method === 'GET' && url.match(/^\/v1\/knowledge\/([^/]+)\/faq\/search/)) {
    await self['handleSearchFAQ'](req, res);
    return true;
  }
  if (method === 'GET' && url.match(/^\/v1\/knowledge\/([^/]+)\/faq$/)) {
    await self['handleListFAQ'](req, res);
    return true;
  }
  if (
    method === 'POST' &&
    url.match(/^\/v1\/knowledge\/([^/]+)\/faq\/import$/)
  ) {
    await self['handleImportFAQ'](req, res);
    return true;
  }
  if (
    method === 'POST' &&
    url.match(/^\/v1\/knowledge\/([^/]+)\/faq\/batch-delete$/)
  ) {
    await self['handleBatchDeleteFAQ'](req, res);
    return true;
  }
  if (method === 'POST' && url.match(/^\/v1\/knowledge\/([^/]+)\/faq$/)) {
    await self['handleCreateFAQ'](req, res);
    return true;
  }
  if (
    method === 'PUT' &&
    url.match(/^\/v1\/knowledge\/([^/]+)\/faq\/([^/]+)$/)
  ) {
    await self['handleUpdateFAQ'](req, res);
    return true;
  }
  if (
    method === 'DELETE' &&
    url.match(/^\/v1\/knowledge\/([^/]+)\/faq\/([^/]+)$/)
  ) {
    await self['handleDeleteFAQ'](req, res);
    return true;
  }
  // ---- Knowledge (generic) ----
  if (method === 'PUT' && url.match(/^\/v1\/knowledge\/(?!bases|docs)(.+)$/)) {
    await self['handleUpdateKnowledge'](
      req,
      res,
      url.match(/^\/v1\/knowledge\/(?!bases|docs)(.+)$/)![1]
    );
    return true;
  }
  if (method === 'DELETE' && url.match(/^\/v1\/knowledge\/(?!bases)(.+)$/)) {
    await self['handleDeleteKnowledge'](
      req,
      res,
      url.match(/^\/v1\/knowledge\/(?!bases)(.+)$/)![1]
    );
    return true;
  }

  // ---- Teams ----
  if (method === 'GET' && url.match(/^\/v1\/workspaces\/(.+)\/teams$/)) {
    const workspaceId = url.match(/^\/v1\/workspaces\/(.+)\/teams$/)![1];
    await self['handleListTeams'](req, res, workspaceId);
    return true;
  }
  if (method === 'POST' && url.match(/^\/v1\/workspaces\/(.+)\/teams$/)) {
    const workspaceId = url.match(/^\/v1\/workspaces\/(.+)\/teams$/)![1];
    await self['handleCreateTeam'](req, res, workspaceId);
    return true;
  }
  if (
    method === 'GET' &&
    url.match(/^\/v1\/workspaces\/(.+)\/teams\/([^/]+)$/)
  ) {
    const match = url.match(/^\/v1\/workspaces\/(.+)\/teams\/([^/]+)$/)!;
    await self['handleGetTeam'](req, res, match[1], match[2]);
    return true;
  }
  if (
    method === 'PUT' &&
    url.match(/^\/v1\/workspaces\/(.+)\/teams\/([^/]+)$/)
  ) {
    const match = url.match(/^\/v1\/workspaces\/(.+)\/teams\/([^/]+)$/)!;
    await self['handleUpdateTeam'](req, res, match[1], match[2]);
    return true;
  }
  if (
    method === 'DELETE' &&
    url.match(/^\/v1\/workspaces\/(.+)\/teams\/([^/]+)$/)
  ) {
    const match = url.match(/^\/v1\/workspaces\/(.+)\/teams\/([^/]+)$/)!;
    await self['handleDeleteTeam'](req, res, match[1], match[2]);
    return true;
  }
  if (
    method === 'POST' &&
    url.match(/^\/v1\/workspaces\/(.+)\/teams\/([^/]+)\/members$/)
  ) {
    const match = url.match(
      /^\/v1\/workspaces\/(.+)\/teams\/([^/]+)\/members$/
    )!;
    await self['handleAddTeamMember'](req, res, match[1], match[2]);
    return true;
  }
  if (
    method === 'DELETE' &&
    url.match(/^\/v1\/workspaces\/(.+)\/teams\/([^/]+)\/members\/([^/]+)$/)
  ) {
    const match = url.match(
      /^\/v1\/workspaces\/(.+)\/teams\/([^/]+)\/members\/([^/]+)$/
    )!;
    await self['handleRemoveTeamMember'](
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
    await self['handleUpdateMemberRole'](
      req,
      res,
      match[1],
      match[2],
      match[3]
    );
    return true;
  }

  // ---- Cost Awareness ----
  if (method === 'GET' && url.match(/^\/v1\/workspaces\/(.+)\/cost\/report$/)) {
    const workspaceId = url.match(/^\/v1\/workspaces\/(.+)\/cost\/report$/)![1];
    await self['handleWorkspaceCostReport'](req, res, workspaceId);
    return true;
  }
  if (method === 'GET' && url.match(/^\/v1\/workspaces\/(.+)\/cost\/budget$/)) {
    const workspaceId = url.match(/^\/v1\/workspaces\/(.+)\/cost\/budget$/)![1];
    await self['handleWorkspaceBudgetStatus'](req, res, workspaceId);
    return true;
  }

  // ---- Unified Usage Cost Routes (v3 统一前缀 /v1/usage/cost/*) ----
  if (method === 'GET' && url === '/v1/usage/cost/summary') {
    await self['handleGlobalCostSummary'](req, res);
    return true;
  }
  if (method === 'GET' && url === '/v1/usage/cost/records') {
    await self['handleGlobalCostRecords'](req, res);
    return true;
  }
  if (method === 'GET' && url === '/v1/usage/cost/range') {
    await self['handleGlobalCostRange'](req, res);
    return true;
  }
  if (method === 'GET' && url === '/v1/usage/cost/report') {
    await self['handleCostReport'](req, res);
    return true;
  }

  // ---- Legacy Cost Routes (301 → /v1/usage/cost/*) ----
  if (method === 'GET' && url === '/api/cost/summary') {
    logger.warning(
      '已废弃路径访问 /api/cost/summary → 301 /v1/usage/cost/summary'
    );
    res.writeHead(301, { Location: '/v1/usage/cost/summary' });
    res.end();
    return true;
  }
  if (method === 'GET' && url === '/api/cost/records') {
    logger.warning(
      '已废弃路径访问 /api/cost/records → 301 /v1/usage/cost/records'
    );
    res.writeHead(301, { Location: '/v1/usage/cost/records' });
    res.end();
    return true;
  }
  if (method === 'GET' && url === '/api/cost/range') {
    logger.warning('已废弃路径访问 /api/cost/range → 301 /v1/usage/cost/range');
    res.writeHead(301, { Location: '/v1/usage/cost/range' });
    res.end();
    return true;
  }
  if (method === 'GET' && url === '/api/cost/report') {
    logger.warning(
      '已废弃路径访问 /api/cost/report → 301 /v1/usage/cost/report'
    );
    res.writeHead(301, { Location: '/v1/usage/cost/report' });
    res.end();
    return true;
  }

  // ---- Work Item Search ----
  if (
    method === 'POST' &&
    url.match(/^\/v1\/workspaces\/(.+)\/items\/search$/)
  ) {
    const workspaceId = url.match(
      /^\/v1\/workspaces\/(.+)\/items\/search$/
    )![1];
    await self['handleSearchWorkItems'](req, res, workspaceId);
    return true;
  }
  if (
    method === 'GET' &&
    url.match(/^\/v1\/workspaces\/(.+)\/items\/review$/)
  ) {
    const workspaceId = url.match(
      /^\/v1\/workspaces\/(.+)\/items\/review$/
    )![1];
    await self['handleWorkItemReview'](req, res, workspaceId);
    return true;
  }

  // ---- Buddy ----
  if (method === 'GET' && url === '/v1/buddy/companion') {
    await self['handleGetBuddy'](req, res);
    return true;
  }
  if (method === 'POST' && url === '/v1/buddy/interact') {
    await self['handleBuddyInteract'](req, res);
    return true;
  }
  if (method === 'GET' && url === '/v1/buddy/stats') {
    await self['handleGetBuddyStats'](req, res);
    return true;
  }
  if (method === 'GET' && url === '/v1/buddy/dreams') {
    await self['handleGetDreamLogs'](req, res);
    return true;
  }

  // ---- Cron (delegated to handlers/cron-handlers.ts) ----
  if (method === 'GET' && url === '/v1/cron') {
    await handleListCron(req, res);
    return true;
  }
  if (method === 'POST' && url === '/v1/cron') {
    await handleCreateCron(req, res, (event, data) =>
      broadcastEvent(event, data)
    );
    return true;
  }
  // 精确路由必须在正则捕获之前，避免 /status 被 /:id 拦截
  if (method === 'GET' && url === '/v1/cron/status') {
    await handleCronStatus(req, res);
    return true;
  }
  if (method === 'GET' && url.startsWith('/v1/cron/runs')) {
    await handleCronRuns(req, res, url);
    return true;
  }
  if (method === 'GET' && url.match(/^\/v1\/cron\/(.+)$/)) {
    await handleGetCron(req, res, url.match(/^\/v1\/cron\/(.+)$/)![1]);
    return true;
  }
  if (method === 'PUT' && url.match(/^\/v1\/cron\/(.+)$/)) {
    await handleUpdateCron(
      req,
      res,
      url.match(/^\/v1\/cron\/(.+)$/)![1],
      (event, data) => broadcastEvent(event, data)
    );
    return true;
  }
  if (method === 'DELETE' && url.match(/^\/v1\/cron\/(.+)$/)) {
    await handleDeleteCron(
      req,
      res,
      url.match(/^\/v1\/cron\/(.+)$/)![1],
      (event, data) => broadcastEvent(event, data)
    );
    return true;
  }
  if (method === 'POST' && url.match(/^\/v1\/cron\/(.+)\/run$/)) {
    await handleRunCron(
      req,
      res,
      url.match(/^\/v1\/cron\/(.+)\/run$/)![1],
      (event, data) => broadcastEvent(event, data)
    );
    return true;
  }

  // ---- Channels ----
  if (method === 'GET' && url === '/v1/channels') {
    await handleListChannels(req, res);
    return true;
  }
  if (method === 'GET' && url.match(/^\/v1\/channels\/(.+)$/)) {
    await handleGetChannel(req, res, url.match(/^\/v1\/channels\/(.+)$/)![1]);
    return true;
  }
  if (method === 'POST' && url.match(/^\/v1\/channels\/(.+)\/toggle$/)) {
    await handleToggleChannel(
      req,
      res,
      url.match(/^\/v1\/channels\/(.+)\/toggle$/)![1],
      (event, data) => broadcastEvent(event, data)
    );
    return true;
  }
  if (method === 'DELETE' && url.match(/^\/v1\/channels\/(.+)$/)) {
    await handleDeleteChannel(
      req,
      res,
      url.match(/^\/v1\/channels\/(.+)$/)![1],
      (event, data) => broadcastEvent(event, data)
    );
    return true;
  }
  if (method === 'PUT' && url.match(/^\/v1\/channels\/(.+)$/)) {
    await handleUpdateChannel(
      req,
      res,
      url.match(/^\/v1\/channels\/(.+)$/)![1],
      (event, data) => broadcastEvent(event, data)
    );
    return true;
  }
  if (method === 'POST' && url === '/v1/channels/config/apply') {
    await handleApplyChannelConfig(req, res);
    return true;
  }

  // ---- Channel Plugins ----
  if (method === 'GET' && url === '/v1/channels/plugins') {
    await self['handleListChannelPlugins'](req, res);
    return true;
  }
  if (method === 'POST' && url === '/v1/channels/plugins/install') {
    await self['handleInstallChannelPlugin'](req, res);
    return true;
  }
  if (method === 'DELETE' && url.match(/^\/v1\/channels\/plugins\/(.+)$/)) {
    await handleUninstallChannelPlugin(
      req,
      res,
      url.match(/^\/v1\/channels\/plugins\/(.+)$/)![1]
    );
    return true;
  }

  // ---- WeChat CLI Status ----
  if (method === 'GET' && url === '/v1/wechat/cli-status') {
    await self['handleWechatCliStatus'](req, res);
    return true;
  }

  // ---- Config ----
  if (method === 'GET' && url === '/favicon.ico') {
    await self['handleFavicon'](req, res);
    return true;
  }
  if (method === 'GET' && url === '/v1/config') {
    await self['handleListConfig'](req, res);
    return true;
  }
  if (method === 'GET' && url.match(/^\/v1\/config\/(.+)$/)) {
    await self['handleGetConfig'](
      req,
      res,
      url.match(/^\/v1\/config\/(.+)$/)![1]
    );
    return true;
  }
  if (method === 'PUT' && url.match(/^\/v1\/config\/(.+)$/)) {
    await self['handleSetConfig'](
      req,
      res,
      url.match(/^\/v1\/config\/(.+)$/)![1]
    );
    return true;
  }
  if (method === 'DELETE' && url.match(/^\/v1\/config\/(.+)$/)) {
    await self['handleDeleteConfig'](
      req,
      res,
      url.match(/^\/v1\/config\/(.+)$/)![1]
    );
    return true;
  }

  // ---- Router（智能路由）----
  if (method === 'GET' && url === '/v1/router/config') {
    await self['handleRouterGetConfig'](req, res);
    return true;
  }
  if (method === 'PUT' && url === '/v1/router/config') {
    await self['handleRouterUpdateConfig'](req, res);
    return true;
  }

  // ---- Settings ----
  if (method === 'GET' && url === '/v1/settings/data-directory') {
    await self['handleGetDataDirectory'](req, res);
    return true;
  }
  if (method === 'PUT' && url === '/v1/settings/data-directory') {
    await self['handleSetDataDirectory'](req, res);
    return true;
  }

  // ---- Skills (ClawHub 生态对接) ----
  if (method === 'GET' && url === '/v1/skills') {
    await self['handleListSkills'](req, res);
    return true;
  }
  if (method === 'GET' && url === '/v1/skills/system') {
    await self['handleListSystemSkills'](req, res);
    return true;
  }
  if (method === 'GET' && url.match(/^\/v1\/skills\/system\/(.+)\/content$/)) {
    await self['handleSystemSkillContent'](
      req,
      res,
      url.match(/^\/v1\/skills\/system\/(.+)\/content$/)![1]
    );
    return true;
  }
  if (method === 'GET' && url === '/v1/skills/search') {
    await self['handleSearchSkills'](req, res);
    return true;
  }
  if (method === 'GET' && url === '/v1/skills/recommended') {
    await self['handleRecommendedSkills'](req, res);
    return true;
  }
  if (method === 'GET' && url === '/v1/skills/categories') {
    await self['handleSkillCategories'](req, res);
    return true;
  }
  if (method === 'GET' && url === '/v1/skills/sources') {
    await self['handleSkillSources'](req, res);
    return true;
  }
  if (method === 'POST' && url === '/v1/skills/sources') {
    await self['handleAddSkillSource'](req, res);
    return true;
  }
  if (method === 'DELETE' && url.match(/^\/v1\/skills\/sources\/(.+)$/)) {
    await self['handleRemoveSkillSource'](
      req,
      res,
      url.match(/^\/v1\/skills\/sources\/(.+)$/)![1]
    );
    return true;
  }
  if (method === 'GET' && url.match(/^\/v1\/skills\/(.+)$/)) {
    await self['handleGetSkillDetail'](
      req,
      res,
      url.match(/^\/v1\/skills\/(.+)$/)![1]
    );
    return true;
  }
  if (method === 'POST' && url === '/v1/skills/install') {
    await self['handleInstallSkill'](req, res);
    return true;
  }
  if (method === 'POST' && url.match(/^\/v1\/skills\/(.+)\/uninstall$/)) {
    await self['handleUninstallSkill'](
      req,
      res,
      url.match(/^\/v1\/skills\/(.+)\/uninstall$/)![1]
    );
    return true;
  }
  if (method === 'POST' && url.match(/^\/v1\/skills\/(.+)\/update$/)) {
    await self['handleUpdateSkill'](
      req,
      res,
      url.match(/^\/v1\/skills\/(.+)\/update$/)![1]
    );
    return true;
  }
  if (method === 'POST' && url.match(/^\/v1\/skills\/(.+)\/toggle$/)) {
    await self['handleToggleSkill'](
      req,
      res,
      url.match(/^\/v1\/skills\/(.+)\/toggle$/)![1]
    );
    return true;
  }
  if (method === 'POST' && url === '/v1/skills') {
    await self['handleCreateSkill'](req, res);
    return true;
  }
  if (method === 'PUT' && url.match(/^\/v1\/skills\/(.+)$/)) {
    await self['handleUpdateSkillById'](
      req,
      res,
      url.match(/^\/v1\/skills\/(.+)$/)![1]
    );
    return true;
  }
  if (method === 'DELETE' && url.match(/^\/v1\/skills\/(.+)$/)) {
    await self['handleDeleteSkill'](
      req,
      res,
      url.match(/^\/v1\/skills\/(.+)$/)![1]
    );
    return true;
  }
  if (method === 'POST' && url.match(/^\/v1\/skills\/(.+)\/enable$/)) {
    await self['handleEnableSkill'](
      req,
      res,
      url.match(/^\/v1\/skills\/(.+)\/enable$/)![1]
    );
    return true;
  }
  if (method === 'POST' && url.match(/^\/v1\/skills\/(.+)\/disable$/)) {
    await self['handleDisableSkill'](
      req,
      res,
      url.match(/^\/v1\/skills\/(.+)\/disable$/)![1]
    );
    return true;
  }

  // ---- Monitor ----
  if (method === 'GET' && url === '/v1/monitor/summary') {
    await self['handleMonitorSummary'](req, res);
    return true;
  }
  if (method === 'GET' && url.startsWith('/v1/monitor/metrics')) {
    await self['handleMonitorMetrics'](req, res);
    return true;
  }
  if (method === 'GET' && url.startsWith('/v1/monitor/alerts')) {
    await self['handleMonitorAlerts'](req, res);
    return true;
  }
  if (
    method === 'POST' &&
    url.match(/^\/v1\/monitor\/alerts\/(.+)\/acknowledge$/)
  ) {
    await self['handleAcknowledgeAlert'](
      req,
      res,
      url.match(/^\/v1\/monitor\/alerts\/(.+)\/acknowledge$/)![1]
    );
    return true;
  }
  if (method === 'GET' && url.startsWith('/v1/monitor/logs')) {
    await self['handleMonitorLogs'](req, res);
    return true;
  }
  // 路径幻觉守卫指标
  if (method === 'GET' && url === '/v1/metrics/path-guard') {
    await self['handlePathGuardMetrics'](req, res);
    return true;
  }
  if (method === 'POST' && url === '/v1/metrics/path-guard/reset') {
    await self['handlePathGuardMetricsReset'](req, res);
    return true;
  }
  // 启动错误日志
  if (method === 'GET' && url === '/v1/diagnostics/startup-error') {
    await self['handleStartupError'](req, res);
    return true;
  }
  // 前端错误上报
  if (method === 'POST' && url === '/v1/errors/report') {
    await self['handleClientErrorReport'](req, res);
    return true;
  }
  // P3-2.11: 后端错误统计
  if (method === 'GET' && url === '/v1/monitoring/errors') {
    self['handleGetErrorStats'](req, res);
    return true;
  }
  // Trace 统计（必选项 — 暴露真实 API token 消耗数据）
  if (method === 'GET' && url === '/v1/trace/stats') {
    await handleTraceStats(req, res);
    return true;
  }
  if (method === 'POST' && url === '/v1/monitor/logs/export') {
    await self['handleExportLogs'](req, res);
    return true;
  }
  if (method === 'GET' && url === '/v1/monitor/sessions') {
    await self['handleMonitorSessions'](req, res);
    return true;
  }
  if (method === 'GET' && url.match(/^\/v1\/monitor\/sessions\/(.+)$/)) {
    await self['handleMonitorSessionDetail'](
      req,
      res,
      url.match(/^\/v1\/monitor\/sessions\/(.+)$/)![1]
    );
    return true;
  }
  if (method === 'GET' && url === '/v1/health/report') {
    await self['handleHealthReport'](req, res);
    return true;
  }
  if (method === 'GET' && url === '/v1/monitor/sessions/summary') {
    await self['handleSessionsSummary'](req, res);
    return true;
  }

  // ---- Inbox ----
  if (url === '/v1/inbox' && method === 'GET') {
    await handleListInbox(req, res, handlerCtx);
    return true;
  }
  if (url === '/v1/inbox/count' && method === 'GET') {
    await handleInboxCount(req, res, handlerCtx);
    return true;
  }
  if (url.startsWith('/v1/inbox/') && url !== '/v1/inbox/count') {
    if (url.endsWith('/reply') && method === 'POST') {
      await handleReplyInbox(req, res, handlerCtx);
      return true;
    }
    if (url.endsWith('/undo') && method === 'POST') {
      await handleUndoApproval(req, res, handlerCtx);
      return true;
    }
    if (method === 'GET') {
      await handleGetInbox(req, res, handlerCtx);
      return true;
    }
  }

  // ---- Notifications ----
  if (url === '/v1/notifications/unread-count' && method === 'GET') {
    await handleUnreadCount(req, res, handlerCtx);
    return true;
  }
  if (url === '/v1/notifications/search' && method === 'GET') {
    await handleSearchNotifications(req, res, handlerCtx);
    return true;
  }
  if (url === '/v1/notifications/read-all' && method === 'PATCH') {
    await handleReadAll(req, res, handlerCtx);
    return true;
  }
  if (url === '/v1/notifications/batch' && method === 'PATCH') {
    await handleBatch(req, res, handlerCtx);
    return true;
  }
  if (url === '/v1/notifications' && method === 'GET') {
    await handleListNotifications(req, res, handlerCtx);
    return true;
  }
  if (url === '/v1/notifications' && method === 'POST') {
    await handleCreateNotification(req, res, handlerCtx);
    return true;
  }
  if (url.startsWith('/v1/notifications/')) {
    const idMatch = url.match(/^\/v1\/notifications\/([^/]+)(\/.*)?$/);
    const id = idMatch ? idMatch[1] : '';
    const suffix = idMatch?.[2] || '';

    if (
      id &&
      id !== 'unread-count' &&
      id !== 'search' &&
      id !== 'read-all' &&
      id !== 'batch'
    ) {
      if (suffix === '/read' && method === 'PATCH') {
        await handleMarkRead(req, res, handlerCtx);
        return true;
      }
      if (suffix === '/dismiss' && method === 'PATCH') {
        await handleDismiss(req, res, handlerCtx);
        return true;
      }
      if (suffix === '/action' && method === 'POST') {
        await handleNotificationAction(req, res, handlerCtx);
        return true;
      }
      if (!suffix && method === 'DELETE') {
        await handleDeleteNotification(req, res, handlerCtx);
        return true;
      }
    }
  }

  if (method === 'GET' && url === '/v1/monitor/otel/metrics') {
    await self['handleOTelMetrics'](req, res);
    return true;
  }
  if (method === 'GET' && url === '/v1/infrastructure/status') {
    await self['handleInfrastructureStatus'](req, res);
    return true;
  }

  // ---- Analytics ----
  if (method === 'GET' && url === '/v1/analytics/dashboard') {
    await self['handleAnalyticsDashboard'](req, res);
    return true;
  }

  // ---- Security ----
  if (method === 'GET' && url === '/v1/security/dashboard') {
    await handleSecurityDashboard(handlerCtx, req, res);
    return true;
  }
  if (method === 'GET' && url === '/v1/security/audit-logs') {
    await handleQueryAuditLogs(handlerCtx, req, res);
    return true;
  }

  // ---- Workflow Templates ----
  if (method === 'GET' && url === '/v1/workflows/templates') {
    await self['handleListWorkflowTemplates'](req, res);
    return true;
  }
  if (method === 'GET' && url.match(/^\/v1\/workflows\/templates\/(.+)$/)) {
    const templateId = url.match(/^\/v1\/workflows\/templates\/(.+)$/)![1];
    await self['handleGetWorkflowTemplate'](req, res, templateId);
    return true;
  }
  if (method === 'POST' && url === '/v1/workflows/templates') {
    await self['handleCreateWorkflowTemplate'](req, res);
    return true;
  }
  if (method === 'PUT' && url.match(/^\/v1\/workflows\/templates\/(.+)$/)) {
    const templateId = url.match(/^\/v1\/workflows\/templates\/(.+)$/)![1];
    await self['handleUpdateWorkflowTemplate'](req, res, templateId);
    return true;
  }
  if (method === 'DELETE' && url.match(/^\/v1\/workflows\/templates\/(.+)$/)) {
    const templateId = url.match(/^\/v1\/workflows\/templates\/(.+)$/)![1];
    await self['handleDeleteWorkflowTemplate'](req, res, templateId);
    return true;
  }

  // ---- Council ----
  if (method === 'GET' && url.match(/^\/v1\/workspaces\/(.+)\/council$/)) {
    const workspaceId = url.match(/^\/v1\/workspaces\/(.+)\/council$/)![1];
    await self['handleListCouncils'](req, res, workspaceId);
    return true;
  }
  if (method === 'POST' && url.match(/^\/v1\/workspaces\/(.+)\/council$/)) {
    const workspaceId = url.match(/^\/v1\/workspaces\/(.+)\/council$/)![1];
    await self['handleCreateCouncil'](req, res, workspaceId);
    return true;
  }
  if (
    method === 'GET' &&
    url.match(/^\/v1\/workspaces\/(.+)\/council\/([^/]+)$/)
  ) {
    const match = url.match(/^\/v1\/workspaces\/(.+)\/council\/([^/]+)$/)!;
    const sessionId = match[2];
    await self['handleGetCouncil'](req, res, sessionId);
    return true;
  }
  if (
    method === 'GET' &&
    url.match(/^\/v1\/workspaces\/(.+)\/council\/([^/]+)\/stream$/)
  ) {
    const match = url.match(
      /^\/v1\/workspaces\/(.+)\/council\/([^/]+)\/stream$/
    )!;
    const sessionId = match[2];
    await self['handleCouncilStream'](req, res, sessionId);
    return true;
  }
  if (
    method === 'POST' &&
    url.match(/^\/v1\/workspaces\/(.+)\/council\/([^/]+)\/statement$/)
  ) {
    const match = url.match(
      /^\/v1\/workspaces\/(.+)\/council\/([^/]+)\/statement$/
    )!;
    const sessionId = match[2];
    await self['handleSubmitStatement'](req, res, sessionId);
    return true;
  }

  // ---- 编排智能 ----
  if (
    method === 'POST' &&
    url.match(/^\/v1\/workspaces\/(.+)\/intelligence\/impact$/)
  ) {
    await self['handleImpactAnalysis'](req, res);
    return true;
  }
  if (
    method === 'POST' &&
    url.match(/^\/v1\/workspaces\/(.+)\/intelligence\/risks$/)
  ) {
    await self['handleRiskDetection'](req, res);
    return true;
  }
  if (
    method === 'POST' &&
    url.match(/^\/v1\/workspaces\/(.+)\/intelligence\/decision$/)
  ) {
    await self['handleDecisionClassify'](req, res);
    return true;
  }
  if (
    method === 'POST' &&
    url.match(/^\/v1\/workspaces\/(.+)\/intelligence\/escalate$/)
  ) {
    await self['handleEscalation'](req, res);
    return true;
  }
  if (
    method === 'GET' &&
    url.match(/^\/v1\/workspaces\/(.+)\/intelligence\/escalations$/)
  ) {
    await self['handleGetEscalations'](req, res);
    return true;
  }
  if (
    method === 'POST' &&
    url.match(/^\/v1\/workspaces\/(.+)\/intelligence\/schedule$/)
  ) {
    await self['handleResourceSchedule'](req, res);
    return true;
  }
  if (
    method === 'GET' &&
    url.match(/^\/v1\/workspaces\/(.+)\/intelligence\/resources$/)
  ) {
    await self['handleGetResources'](req, res);
    return true;
  }

  // ---- 规则管理 ----
  if (method === 'GET' && url.match(/^\/v1\/workspaces\/(.+)\/rules$/)) {
    const match = url.match(/^\/v1\/workspaces\/(.+)\/rules$/)!;
    const workspaceId = match[1];
    await self['handleListRules'](req, res, workspaceId);
    return true;
  }
  if (
    method === 'GET' &&
    url.match(/^\/v1\/workspaces\/(.+)\/rules\/overview$/)
  ) {
    await self['handleRulesOverview'](req, res);
    return true;
  }
  if (method === 'POST' && url.match(/^\/v1\/workspaces\/(.+)\/rules\/load$/)) {
    await self['handleLoadRulesForWorkItem'](req, res);
    return true;
  }
  if (
    method === 'GET' &&
    url.match(/^\/v1\/workspaces\/(.+)\/rules\/([^/]+)$/)
  ) {
    const match = url.match(/^\/v1\/workspaces\/(.+)\/rules\/([^/]+)$/)!;
    const specialization = match[2];
    await self['handleGetRule'](req, res, specialization);
    return true;
  }
  if (
    method === 'PUT' &&
    url.match(/^\/v1\/workspaces\/(.+)\/rules\/([^/]+)$/)
  ) {
    const match = url.match(/^\/v1\/workspaces\/(.+)\/rules\/([^/]+)$/)!;
    const specialization = match[2];
    await self['handleWriteRule'](req, res, specialization);
    return true;
  }
  if (
    method === 'POST' &&
    url.match(/^\/v1\/workspaces\/(.+)\/rules\/([^/]+)$/)
  ) {
    const match = url.match(/^\/v1\/workspaces\/(.+)\/rules\/([^/]+)$/)!;
    const specialization = match[2];
    await self['handleAppendRule'](req, res, specialization);
    return true;
  }

  // ---- 瓶颈感知 ----
  if (
    method === 'POST' &&
    url.match(/^\/v1\/workspaces\/(.+)\/intelligence\/bottleneck$/)
  ) {
    await self['handleBottleneckAnalysis'](req, res);
    return true;
  }

  // ---- Commands ----
  if (method === 'GET' && url === '/v1/commands') {
    await self['handleListCommands'](req, res);
    return true;
  }
  if (method === 'POST' && url === '/v1/commands/execute') {
    await self['handleExecuteCommand'](req, res);
    return true;
  }

  // ---- MCP Marketplace ----
  if (method === 'GET' && url === '/v1/mcp/marketplace/search') {
    await self['handleMCPMarketplaceSearch'](req, res);
    return true;
  }
  if (method === 'GET' && url === '/v1/mcp/marketplace/registries') {
    await self['handleMCPMarketplaceRegistries'](req, res);
    return true;
  }
  if (method === 'GET' && url === '/v1/mcp/marketplace/categories') {
    await self['handleMCPMarketplaceCategories'](req, res);
    return true;
  }
  if (
    method === 'GET' &&
    url.match(/^\/v1\/mcp\/marketplace\/servers\/(.+)$/)
  ) {
    await self['handleMCPMarketplaceServerDetail'](
      req,
      res,
      url.match(/^\/v1\/mcp\/marketplace\/servers\/(.+)$/)![1]
    );
    return true;
  }
  if (method === 'GET' && url === '/v1/mcp/marketplace/installed') {
    await self['handleMCPInstalledServers'](req, res);
    return true;
  }
  if (
    method === 'POST' &&
    url.match(/^\/v1\/mcp\/marketplace\/servers\/(.+)\/install$/)
  ) {
    await self['handleMCPInstallServer'](
      req,
      res,
      url.match(/^\/v1\/mcp\/marketplace\/servers\/(.+)\/install$/)![1]
    );
    return true;
  }
  if (
    method === 'POST' &&
    url.match(/^\/v1\/mcp\/marketplace\/servers\/(.+)\/uninstall$/)
  ) {
    await self['handleMCPUninstallServer'](
      req,
      res,
      url.match(/^\/v1\/mcp\/marketplace\/servers\/(.+)\/uninstall$/)![1]
    );
    return true;
  }
  if (
    method === 'POST' &&
    url.match(/^\/v1\/mcp\/marketplace\/servers\/(.+)\/toggle$/)
  ) {
    await self['handleMCPToggleServer'](
      req,
      res,
      url.match(/^\/v1\/mcp\/marketplace\/servers\/(.+)\/toggle$/)![1]
    );
    return true;
  }

  // ---- MCP Server Verify ----
  if (method === 'POST' && url.match(/^\/v1\/mcp\/servers\/(.+)\/verify$/)) {
    await self['handleMCPVerifyServer'](
      req,
      res,
      url.match(/^\/v1\/mcp\/servers\/(.+)\/verify$/)![1]
    );
    return true;
  }

  // ---- MCP OAuth Callback ----
  if (method === 'GET' && url.startsWith('/v1/mcp/oauth/callback')) {
    const { handleMCPOAuthCallback } = await import('./mcp-oauth-handler');
    await handleMCPOAuthCallback(req, res);
    return true;
  }

  // ---- MCP Tools ----
  if (method === 'GET' && url === '/v1/mcp/tools') {
    await self['handleMCPListTools'](req, res);
    return true;
  }
  if (method === 'PATCH' && url.match(/^\/v1\/mcp\/tools\/(.+)\/toggle$/)) {
    await self['handleMCPToggleTool'](
      req,
      res,
      url.match(/^\/v1\/mcp\/tools\/(.+)\/toggle$/)![1]
    );
    return true;
  }

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

  // ---- API Keys ----
  if (method === 'GET' && url === '/v1/apikeys') {
    await self['handleListApiKeys'](req, res);
    return true;
  }
  if (method === 'POST' && url === '/v1/apikeys') {
    await self['handleCreateApiKey'](req, res);
    return true;
  }
  if (method === 'DELETE' && url.match(/^\/v1\/apikeys\/(.+)$/)) {
    await self['handleDeleteApiKey'](
      req,
      res,
      url.match(/^\/v1\/apikeys\/(.+)$/)![1]
    );
    return true;
  }

  // ---- File Open/Read/Paths/Resolve/Preview ----
  if (method === 'GET' && url === '/api/file/open') {
    await self['handleFileOpen'](req, res);
    return true;
  }
  if (method === 'GET' && url.startsWith('/api/file/read')) {
    await self['handleFileRead'](req, res);
    return true;
  }
  if (method === 'GET' && url === '/api/file/paths') {
    await self['handleFilePaths'](req, res);
    return true;
  }
  if (method === 'GET' && url.startsWith('/api/file/resolve-path')) {
    await self['handleFileResolvePath'](req, res);
    return true;
  }
  if (method === 'GET' && url === '/api/file/preview') {
    await self['handleFilePreview'](req, res);
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
        await import('../../../../src/dream/DreamMetrics');
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
