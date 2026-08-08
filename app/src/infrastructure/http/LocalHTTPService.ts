/**
 * LocalHTTPService 本地 HTTP API 服务
 * 提供 OpenAI 兼容的 API 接口，允许 Tauri 客户端通过 HTTP 调用 CoreAPI
 *
 * 注意：本文件位于 core/gateway/local/（遗留 Gateway 体系目录），
 * 但实际消费 channels/ 目录下的 IChannelPlugin 接口。
 * 此位置具有误导性，后续应考虑迁移至 modules/ 下的合适位置。
 */

import http from 'http';
import fs from 'fs';
import path from 'path';
import { Logger, LogLevel } from '@modules/monitoring';
import { handleError } from '@modules/error';
import type { ServerResponse } from 'http';
import { getCoreAPI } from '@modules/runtime/api/CoreAPIImpl';
import { createChatManager } from '@modules/chat/ChatManager';
import { costTracker } from '@modules/cost/CostTracker';
import { CostReportEndpoint } from '@modules/cost/CostReportEndpoint';
import { getCostRecordRepository } from '@modules/cost/CostRecordRepository';
import { analyticsService } from '@modules/analytics/AnalyticsService';
import { PerformanceMonitorService } from '@modules/analytics/PerformanceMonitorService';
import { configManager } from '@modules/config';
import type { IChannelPlugin } from '@modules/channels/types';
import type {
  RegistryType,
  ThirdPartyRegistry,
} from '@modules/services/mcp/marketplace/types';
// 3.4/P1-1：流式 STT WebSocket 端点（前端按住说话实时字幕 + 统一转录链路）
import { upgradeSTTStreamConnection } from '../../voice/STTStreamServer';

import {
  handleMonitorSummary,
  handleMonitorMetrics,
  handleMonitorAlerts,
  handleAcknowledgeAlert,
  handleMonitorLogs,
  handleExportLogs,
  handleMonitorSessions,
  handleMonitorSessionDetail,
  handleSessionsSummary,
  handleOTelMetrics,
  handleInfrastructureStatus,
  handlePathGuardMetrics,
  handlePathGuardMetricsReset,
  handleStartupError,
} from './handlers/monitoring-handlers';
import {
  handleClientErrorReport,
  handleGetErrorStats,
} from './handlers/error-report-handlers';
import {
  handleHealthReport,
  handleAnalyticsDashboard,
  setAnalyticsDependencies,
} from './handlers/analytics-handlers';
import { setupInfrastructureDiagnostics } from '@modules/diagnostics/infrastructure-diagnostics';
import type { SkillSearchEngine } from '@modules/skills/loaders/adapter/SkillSearchEngine';
import type { LocalSkillStore } from '@modules/skills/loaders/adapter/LocalSkillStore';

import {
  handleChatCompletions,
  handleQuestionAnswer,
  handleSessionStreamingStatus,
  handleLatestCheckpoint,
  handleResumeChat,
} from './handlers/chat-handlers';
import {
  handleFileRegistryList,
  handleFileRegistryDetail,
  handleFileRegistrySearch,
  handleFileRegistryStats,
  handleFileRegistryDelete,
  handleFileHealth,
} from './handlers/files-handlers';

import {
  handleListSessions,
  handleCreateSession,
  handleGetSession,
  handleGetSessionMessages,
  handleUpdateMessageBlocks,
  handleDeleteSession,
  handleClearAllSessions,
  handleGetCurrentSession,
  handleSwitchSession,
  handleRenameSession,
  handleGenerateTitle,
  handleUpdateSessionMeta,
  handleCompactSession,
  handlePruneSession,
  handleGetSessionMemory,
} from './handlers/session-handlers';
import {
  handleDeleteMessage,
  handleTruncateMessages,
} from './handlers/message-handlers';
import { handleListTools, handleExecuteTool } from './handlers/tools-handlers';
import {
  handleImageStatic,
  handleImageList,
  handleImageMetadata,
  handleImageUpload,
  handleImageDelete,
} from './handlers/image-handlers';
import {
  handleVideoStatic,
  handleVideoList,
  handleVideoMetadata,
  handleVideoBySourceImage,
  handleVideoDelete,
} from './handlers/video-handlers';
import { handleVideoTasks } from './handlers/video-task-handlers';
import { handleAudioStatic } from './handlers/audio-handlers';
import { handleMedia } from './handlers/media-template-handlers';
import {
  handleListAgentTasks,
  handleExecuteAgentTask,
  handleGetAgentProgress,
} from './handlers/agent1-handlers';
import {
  handleSearchWorkItems,
  handleWorkItemReview,
} from './handlers/workitem-search-handlers';
import {
  handleListWorkspaces,
  handleListWorkspaceSessions,
  handleCreateWorkspaceSession,
  handleListWorkItems,
  handleCreateWorkItem,
  handleUpdateWorkItem,
  handleDetectLiriDir,
  handleInitLiriDir,
  handleGetWorkspaceConfig,
  handleUpdateWorkspaceConfig,
  handleGetWorkspaceRules,
  handleUpdateWorkspaceRules,
  handleListChangeSets,
  handleCreateChangeSet,
  handleGetChangeSet,
  handleAddFileChange,
  handleUpdateChangeSet,
  handleGetChangeSetSummary,
  handleListProjects,
  handleCreateProject,
  handleGetProject,
  handleUpdateProject,
  handleDeleteProject,
  handleGetProjectBoard,
  handleGetProjectRules,
  handleUpdateProjectRules,
  handleGetTemplates,
  handleCreateProjectWorkItem,
  handleDecomposeProject,
  handleListTasks,
  handleGetTask,
  handleCreateTask,
  handleUpdateTask,
  handleDeleteTask,
  handleListTaskChildren,
} from './handlers/workspaces-handlers';
import {
  handleOrchestrationStream,
  handleGetOrchestrationSnapshot,
  handleGetOrchestrationHistory,
  handleGetSwarmStatus,
  handleGetAgentModelBindings,
  handleUpdateAgentModelBindings,
} from './handlers/orchestration-handlers';
import {
  handleListTeams,
  handleCreateTeam,
  handleGetTeam,
  handleUpdateTeam,
  handleDeleteTeam,
  handleAddTeamMember,
  handleRemoveTeamMember,
  handleUpdateMemberRole,
} from './handlers/team-handlers';
import {
  handleWorkspaceCostReport,
  handleWorkspaceBudgetStatus,
} from './handlers/cost-handlers';
import {
  handleListWorkflowTemplates,
  handleGetWorkflowTemplate,
  handleCreateWorkflowTemplate,
  handleUpdateWorkflowTemplate,
  handleDeleteWorkflowTemplate,
} from './handlers/workflow-template-handlers';
import {
  handleCreateCouncil,
  handleGetCouncil,
  handleCouncilStream,
  handleListCouncils,
  handleSubmitStatement,
} from './handlers/council-handlers';
import {
  handleImpactAnalysis,
  handleRiskDetection,
  handleDecisionClassify,
  handleEscalation,
  handleGetEscalations,
  handleResourceSchedule,
  handleGetResources,
} from './handlers/orch-intelligence-handlers';
import {
  handleListRules,
  handleGetRule,
  handleWriteRule,
  handleAppendRule,
  handleLoadRulesForWorkItem,
  handleRulesOverview,
} from './handlers/rule-handlers';
import type { RuleSpecialization } from '@modules/workspace/RuleEngine';
import { handleBottleneckAnalysis } from './handlers/bottleneck-handlers';
import {
  handleListKnowledge,
  handleSearchKnowledge,
  handleCreateKnowledge,
  handleUpdateKnowledge,
  handleDeleteKnowledge,
  handleListKnowledgeBases,
  handleCreateKnowledgeBase,
  handleUpdateKnowledgeBase,
  handleDeleteKnowledgeBase,
  handleCloneKnowledgeBase,
  handleDuplicateKnowledgeBase,
  handleSaveFromChat,
  handleKnowledgeUpload,
  handleKnowledgeCompile,
  handleKnowledgeCompileStatus,
  handleGetRawFiles,
  handleKnowledgeHealth,
  handleExportToNotebook,
  handleImportFromFile,
  handleUpdateKnowledgeDoc,
  handleBatchDeleteKnowledge,
  handleBatchTagKnowledge,
  handleListSnapshots,
  handleRestoreSnapshot,
  handleTrashKnowledge,
  handleRestoreTrash,
  handleExportKnowledge,
} from './handlers/knowledge-handlers';
import {
  handleListFAQ,
  handleCreateFAQ,
  handleUpdateFAQ,
  handleDeleteFAQ,
  handleBatchDeleteFAQ,
  handleImportFAQ,
  handleSearchFAQ,
  handleFAQCategories,
} from './handlers/faq-handlers';
import {
  handleFileUpload,
  handleConvertFile,
  handleDetectFileType,
  handleSendFileToAI,
} from './handlers/files-handlers';
import { handleEvents } from './LocalHTTPServiceSSE';
import {
  handleGetBuddy,
  handleBuddyInteract,
  handleGetBuddyStats,
  handleGetDreamLogs,
} from './handlers/buddy-handlers';
import { HandlerCtx, createHandlerCtx } from './handlers/handler-utils';
import { SandboxPermission } from '@modules/sandbox/SandboxTypes';
import { dispatchRoute } from './handlers/route-table';
import {
  verifyRequestAuth,
  seedKnowledgeBaseIfEmpty,
  startCompileScheduler,
} from './LocalHTTPServiceHelpers';
import { broadcastEvent, stopSSE } from './LocalHTTPServiceSSE';
const logger = new Logger({ module: 'http:local', level: LogLevel.INFO });

/**
 * LocalHTTPService 配置
 */
export interface LocalHTTPConfig {
  host: string;
  port: number;
}

/** SkillRegistry 最小接口（5.6：system 列表 status 反映真实启用状态） */
interface SkillRegistryLike {
  get(
    name: string,
    opts?: { includeDisabled?: boolean }
  ): { name: string; isEnabled?: () => boolean } | undefined;
}

/** ClawHubAdapter 方法的最小接口（与真实实现对齐，v1.5 阶段 3：消除 as unknown as 断言） */
interface ClawHubAdapterLike {
  initialize(): Promise<void>;
  getInstalledSkills(): Promise<unknown[]>;
  searchSkills(
    query: string,
    opts?: { category?: string; tags?: string[]; source?: string }
  ): Promise<unknown[]>;
  getSearchEngine(): SkillSearchEngine;
  getSkillDetail(id: string): Promise<unknown>;
  getRemoteVersion(id: string): Promise<string | null>;
  getSkillRegistry(): SkillRegistryLike | null;
  installSkill(id: string, sourceUrl?: string): Promise<unknown>;
  uninstallSkill(id: string): Promise<unknown>;
  updateSkill(id: string): Promise<unknown>;
  enableSkill(id: string): Promise<void>;
  disableSkill(id: string): Promise<void>;
  getLocalStore(): LocalSkillStore;
}

/** PDCA Orchestrator 方法的最小接口 */
interface PdcaOrchestratorLike {
  getStatus(): unknown;
  generateReport(): unknown;
  reviewStep(stepId: string): Promise<unknown>;
  decideStep(stepId: string, decision: unknown): Promise<void>;
}

/**
 * LocalHTTPService 类
 * 提供本地 HTTP API 服务，对接 CoreAPI
 */
export class LocalHTTPService {
  private server: http.Server | null = null;
  private config: LocalHTTPConfig;
  private _isRunning = false;
  /** 应用是否已完全就绪（launch 完成前前端请求返回 503） */
  static _appReady = false;
  private readonly apiSecret: string;
  private compileScheduler: unknown = null;
  /** handler 上下文（提供 sendError, readRequestBody, broadcastEvent 等） */
  private readonly _handlerCtx: HandlerCtx = createHandlerCtx();

  constructor(config: LocalHTTPConfig) {
    this.config = config;
    setAnalyticsDependencies(
      analyticsService,
      costTracker,
      getCostRecordRepository(),
      PerformanceMonitorService
    );
    setupInfrastructureDiagnostics();
    this.apiSecret = configManager.env('LIRI_API_SECRET') || '';
  }

  /**
   * 检查服务是否正在运行
   */
  isStarted(): boolean {
    return this._isRunning;
  }

  /**
   * 获取服务端口号
   */
  getPort(): number | undefined {
    const addr = this.server?.address();
    if (addr && typeof addr === 'object') {
      return addr.port;
    }
    return undefined;
  }

  /**
   * 校验请求是否携带有效的共享密钥
   * 委托给 LocalHTTPServiceHelpers.verifyRequestAuth
   */
  private verifyRequestAuth(req: http.IncomingMessage): boolean {
    return verifyRequestAuth(req, this.apiSecret);
  }

  /**
   * 种子知识库：委托给 LocalHTTPServiceHelpers.seedKnowledgeBaseIfEmpty
   */
  private async seedKnowledgeBaseIfEmpty(): Promise<void> {
    return seedKnowledgeBaseIfEmpty();
  }

  /**
   * 启动编译调度器
   * 委托给 LocalHTTPServiceHelpers.startCompileScheduler
   */
  private async startCompileScheduler(): Promise<void> {
    this.compileScheduler = await startCompileScheduler();
  }

  /**
   * 启动 HTTP 服务
   */
  async start(): Promise<void> {
    if (this.server) {
      logger.warning('LocalHTTPService 已经启动，无需重复启动');
      return;
    }

    this.server = http.createServer((req, res) => {
      this.handleRequest(req, res).catch((err) => {
        void handleError(err, {
          module: 'infra:http',
          action: 'handle_request',
        });
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({ error: { message: 'Internal server error' } })
          );
        }
      });
    });

    // 配置长连接超时，支持 SSE 流式请求
    // server.timeout: 0 表示禁用请求超时（SSE 流式请求可能持续很长时间）
    // keepAliveTimeout: 服务器在发送最后一个响应后等待更多数据的时间
    // headersTimeout: 服务器等待客户端发送完整请求头的时间
    this.server.timeout = 0; // 禁用请求超时，支持长时间 SSE 流
    this.server.keepAliveTimeout = 60000 * 5; // 5分钟
    this.server.headersTimeout = 60000 * 6; // 6分钟（必须大于 keepAliveTimeout）

    // 3.4/P1-1：流式 STT WebSocket 升级分发（/v1/voice/stt）
    this.server.on('upgrade', (req, socket, head) => {
      try {
        const url = (req.url ?? '').split('?')[0];
        if (url !== '/v1/voice/stt') {
          socket.destroy();
          return;
        }

        // 将 upgrade 首包放回 socket 缓冲，保证首个 WS 帧不丢失
        if (head && head.length > 0) {
          socket.unshift(head);
        }

        // upgradeToVoiceConnection 需要 ServerResponse 形态对象（res.writeHead/res.socket）
        const fakeRes = {
          writeHead: () => socket,
          end: () => socket,
          socket,
        } as unknown as ServerResponse;

        upgradeSTTStreamConnection(req, fakeRes);
      } catch (err) {
        void handleError(err, {
          module: 'infra:http',
          action: 'upgrade_stt_stream',
        });
        socket.destroy();
      }
    });

    // P3-2: 超时事件监听 — 审计用。虽 server.timeout=0，但 socket 层仍可能触发
    this.server.on('timeout', (socket) => {
      logger.warn('HTTP socket 超时事件触发', {
        remoteAddress: socket.remoteAddress,
        remotePort: socket.remotePort,
        localPort: (socket as unknown as { localPort?: number }).localPort,
      });
      // 不销毁 socket — timeout=0 时不应用，但监听可防止默认销毁行为
    });

    return new Promise((resolve, reject) => {
      this.server!.listen(this.config.port, this.config.host, () => {
        this._isRunning = true;
        logger.info(
          `LocalHTTPService 已启动: http://${this.config.host}:${this.config.port}`
        );
        // 异步初始化知识库种子，不阻塞启动
        this.seedKnowledgeBaseIfEmpty().catch(
          (err) =>
            void handleError(err, {
              module: 'infrastructure:http:local',
              action: 'seedKnowledge',
            })
        );
        this.startCompileScheduler().catch(
          (err) =>
            void handleError(err, {
              module: 'infrastructure:http:local',
              action: 'startCompileScheduler',
            })
        );
        resolve();
      });

      this.server!.on('error', (err) => {
        logger.error('LocalHTTPService 启动失败', { error: err.message });
        this._isRunning = false;
        reject(err);
      });
    });
  }

  /**
   * 停止 HTTP 服务
   */
  async stop(): Promise<void> {
    if (this.compileScheduler) {
      (this.compileScheduler as { stop(): void }).stop();
      this.compileScheduler = null;
    }
    stopSSE();
    return new Promise((resolve, reject) => {
      if (!this.server) {
        logger.info('LocalHTTPService 未启动，无需停止');
        resolve();
        return;
      }

      this.server.close((err) => {
        if (err) {
          logger.error('LocalHTTPService 停止失败', { error: err.message });
          reject(err);
        } else {
          this.server = null;
          this._isRunning = false;
          logger.info('LocalHTTPService 已停止');
          resolve();
        }
      });
    });
  }

  /**
   * 处理 HTTP 请求
   */
  private async handleRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    // S2-5：CORS 收紧 —— 仅放行 localhost / 127.0.0.1 任意端口（含 Tauri dev 5173/1420）；
    // 无 Origin（Tauri 原生/非浏览器）保持 * 兼容
    const origin = req.headers.origin;
    if (origin) {
      try {
        const { hostname } = new URL(origin);
        if (hostname === 'localhost' || hostname === '127.0.0.1') {
          res.setHeader('Access-Control-Allow-Origin', origin);
        }
      } catch {
        // 非法 Origin：不设置 CORS 头（浏览器将拦截跨域）
      }
    } else {
      res.setHeader('Access-Control-Allow-Origin', '*');
    }
    res.setHeader(
      'Access-Control-Allow-Methods',
      'GET, POST, PUT, PATCH, DELETE, OPTIONS'
    );
    res.setHeader(
      'Access-Control-Allow-Headers',
      'Content-Type, Authorization, x-api-key, traceparent, tracestate'
    );

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // 共享密钥校验：确保请求来自被授权的 Tauri 客户端；
    // 兼容登录会话：携带有效 Bearer 登录 token 的请求同样放行（M0d）
    if (!this.verifyRequestAuth(req)) {
      const authHeader = req.headers['authorization'] || '';
      const sessionToken = authHeader.startsWith('Bearer ')
        ? authHeader.slice(7)
        : '';
      let validSession = false;
      if (sessionToken) {
        const { authTokens } = await import('./handlers/auth-handlers');
        validSession = authTokens.has(sessionToken);
      }
      if (!validSession) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'Unauthorized' } }));
        return;
      }
    }

    const url = req.url?.split('?')[0] || '';

    // 应用尚未完全就绪时，对业务请求返回 503
    if (!LocalHTTPService._appReady && url !== '/v1/health/report') {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({ error: { message: 'Service starting, please retry' } })
      );
      return;
    }

    logger.debug('收到请求', {
      method: req.method,
      url: req.url,
      parsedUrl: url,
    });

    // ---- 所有路由逻辑已提取至 route-table.ts 的 dispatchRoute ----
    // ---- 路由调度（匹配 method + URL 到对应 handler）----
    const matched = await dispatchRoute(
      req,
      res,
      url,
      this as unknown as Record<string, Function>,
      (event: string, data: unknown) =>
        this.broadcastEvent(event, data as Record<string, unknown>),
      this._handlerCtx
    );
    if (matched) return;

    logger.warning('未匹配的路由', {
      method: req.method,
      url: req.url,
      parsedUrl: url,
    });
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        error: { message: 'Not found', type: 'invalid_request_error' },
      })
    );
  }

  // CPU 使用率跟踪状态（已移至 monitoring-handlers.ts）

  /**
   * 计算当前 CPU 使用率（基于 process.cpuUsage 差值）
   * 返回值为 0~100 的百分比（占系统总 CPU 容量的比例）
   */
  // ========== Monitoring Handlers (extracted to handlers/monitoring-handlers.ts) ==========

  private async handleMonitorSummary(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    return handleMonitorSummary(this._handlerCtx, req, res);
  }

  private async handleMonitorMetrics(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    return handleMonitorMetrics(this._handlerCtx, req, res);
  }

  private async handleMonitorAlerts(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    return handleMonitorAlerts(this._handlerCtx, req, res);
  }

  private async handleAcknowledgeAlert(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    alertId: string
  ): Promise<void> {
    return handleAcknowledgeAlert(this._handlerCtx, req, res, { $1: alertId });
  }

  private async handleMonitorLogs(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    return handleMonitorLogs(this._handlerCtx, req, res);
  }

  private async handleExportLogs(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    return handleExportLogs(this._handlerCtx, req, res);
  }

  private async handleMonitorSessions(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    return handleMonitorSessions(this._handlerCtx, req, res);
  }

  private async handleMonitorSessionDetail(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    sessionId: string
  ): Promise<void> {
    return handleMonitorSessionDetail(this._handlerCtx, req, res, {
      $1: sessionId,
    });
  }

  private async handleSessionsSummary(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    return handleSessionsSummary(this._handlerCtx, req, res);
  }

  private async handleOTelMetrics(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    return handleOTelMetrics(this._handlerCtx, req, res);
  }

  private async handleInfrastructureStatus(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    return handleInfrastructureStatus(this._handlerCtx, req, res);
  }

  private async handlePathGuardMetrics(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    return handlePathGuardMetrics(this._handlerCtx, req, res);
  }

  private async handlePathGuardMetricsReset(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    return handlePathGuardMetricsReset(this._handlerCtx, req, res);
  }

  private async handleStartupError(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    return handleStartupError(this._handlerCtx, req, res);
  }

  private async handleClientErrorReport(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    return handleClientErrorReport(req, res);
  }

  private handleGetErrorStats(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): void {
    return handleGetErrorStats(req, res);
  }

  // ========== Health / Analytics / Cost Handlers (extracted to handlers/analytics-handlers.ts) ==========

  private async handleHealthReport(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    return handleHealthReport(this._handlerCtx, req, res);
  }

  private async handleAnalyticsDashboard(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    return handleAnalyticsDashboard(this._handlerCtx, req, res);
  }

  private async handleCostReport(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    const urlObj = new URL(req.url!, `http://${req.headers.host}`);
    const format = urlObj.searchParams.get('format') || 'json';
    const period = urlObj.searchParams.get('period') || 'all';

    const endpoint = new CostReportEndpoint();
    const result = await endpoint.handle({
      format: format as 'json' | 'text' | 'csv' | 'prometheus',
      period: period as 'today' | 'week' | 'month' | 'custom',
    });

    const contentType =
      format === 'text' || format === 'csv' || format === 'prometheus'
        ? 'text/plain; charset=utf-8'
        : 'application/json; charset=utf-8';

    res.writeHead(200, { 'Content-Type': contentType });
    res.end(result);
  }

  // ========== Chat Handlers (extracted to handlers/chat-handlers.ts) ==========

  private async handleChatCompletions(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    return handleChatCompletions(this._handlerCtx, req, res);
  }

  private async handleQuestionAnswer(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    return handleQuestionAnswer(this._handlerCtx, req, res);
  }

  private async handleListSessions(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    return handleListSessions(this._handlerCtx, req, res);
  }

  private async handleCreateSession(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    return handleCreateSession(this._handlerCtx, req, res);
  }

  private async handleGetSession(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    sessionId: string
  ): Promise<void> {
    return handleGetSession(this._handlerCtx, req, res, sessionId);
  }

  /** P1-5: 会话流式状态查询 — 前端幽灵块检测用 */
  private async handleSessionStreamingStatus(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    sessionId: string
  ): Promise<void> {
    return handleSessionStreamingStatus(this._handlerCtx, req, res, sessionId);
  }

  /** P2-1: 最新检查点查询 — 前端断线重连用 */
  private async handleLatestCheckpoint(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    sessionId: string
  ): Promise<void> {
    return handleLatestCheckpoint(this._handlerCtx, req, res, sessionId);
  }

  /** P2-1: 从检查点恢复 SSE 流 — 前端断线重连用 */
  private async handleResumeChat(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    return handleResumeChat(this._handlerCtx, req, res);
  }

  private async handleGetSessionMessages(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    sessionId: string
  ): Promise<void> {
    return handleGetSessionMessages(this._handlerCtx, req, res, sessionId);
  }

  private async handleDeleteMessage(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    sessionId: string,
    messageId: string
  ): Promise<void> {
    return handleDeleteMessage(
      this._handlerCtx,
      req,
      res,
      sessionId,
      messageId
    );
  }

  private async handleTruncateMessages(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    sessionId: string
  ): Promise<void> {
    return handleTruncateMessages(this._handlerCtx, req, res, sessionId);
  }

  private async handleUpdateMessageBlocks(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    sessionId: string,
    messageId: string
  ): Promise<void> {
    return handleUpdateMessageBlocks(
      this._handlerCtx,
      req,
      res,
      sessionId,
      messageId
    );
  }

  private async handleDeleteSession(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    sessionId: string
  ): Promise<void> {
    return handleDeleteSession(this._handlerCtx, req, res, sessionId);
  }

  private async handleClearAllSessions(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    return handleClearAllSessions(this._handlerCtx, req, res);
  }

  private async handleGetCurrentSession(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    return handleGetCurrentSession(this._handlerCtx, req, res);
  }

  private async handleSwitchSession(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    sessionId: string
  ): Promise<void> {
    return handleSwitchSession(this._handlerCtx, req, res, sessionId);
  }

  private async handleRenameSession(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    sessionId: string
  ): Promise<void> {
    return handleRenameSession(this._handlerCtx, req, res, sessionId);
  }

  private async handleGenerateTitle(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    sessionId: string
  ): Promise<void> {
    return handleGenerateTitle(this._handlerCtx, req, res, sessionId);
  }

  /**
   * PATCH /v1/sessions/:id/meta — 更新会话元数据
   */
  private async handleUpdateSessionMeta(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    sessionId: string
  ): Promise<void> {
    return handleUpdateSessionMeta(this._handlerCtx, req, res, sessionId);
  }

  private async handleCompactSession(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    sessionId: string
  ): Promise<void> {
    return handleCompactSession(this._handlerCtx, req, res, sessionId);
  }

  private async handlePruneSession(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    sessionId: string
  ): Promise<void> {
    return handlePruneSession(this._handlerCtx, req, res, sessionId);
  }

  private async handleGetSessionMemory(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    sessionId: string
  ): Promise<void> {
    return handleGetSessionMemory(this._handlerCtx, req, res, sessionId);
  }

  // ========== Tools Handlers (extracted to handlers/tools-handlers.ts) ==========

  private async handleListTools(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    return handleListTools(this._handlerCtx, req, res);
  }

  private async handleExecuteTool(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    toolName: string
  ): Promise<void> {
    return handleExecuteTool(this._handlerCtx, req, res, toolName);
  }

  // ========== Image Handlers (extracted to handlers/image-handlers.ts) ==========

  private async handleImageStatic(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    filePath: string
  ): Promise<void> {
    return handleImageStatic(this._handlerCtx, req, res, filePath);
  }

  private async handleImageList(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    return handleImageList(this._handlerCtx, req, res);
  }

  private async handleImageUpload(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    return handleImageUpload(this._handlerCtx, req, res);
  }

  private async handleImageDelete(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    return handleImageDelete(this._handlerCtx, req, res);
  }

  private async handleImageMetadata(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    return handleImageMetadata(this._handlerCtx, req, res);
  }

  // ========== Video Handlers (extracted to handlers/video-handlers.ts) ==========

  private async handleVideoStatic(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    filePath: string
  ): Promise<void> {
    return handleVideoStatic(this._handlerCtx, req, res, filePath);
  }

  private async handleVideoList(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    return handleVideoList(this._handlerCtx, req, res);
  }

  private async handleVideoDelete(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    return handleVideoDelete(this._handlerCtx, req, res);
  }

  private async handleVideoMetadata(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    return handleVideoMetadata(this._handlerCtx, req, res);
  }

  private async handleVideoBySourceImage(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    return handleVideoBySourceImage(this._handlerCtx, req, res);
  }

  private async handleAudioStatic(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    filePath: string
  ): Promise<void> {
    return handleAudioStatic(this._handlerCtx, req, res, filePath);
  }

  private async handleVideoTasks(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    return handleVideoTasks(this._handlerCtx, req, res);
  }

  private async handleMedia(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    return handleMedia(this._handlerCtx, req, res);
  }

  // ========== Agent Handlers (extracted to handlers/agent1-handlers.ts) ==========

  private async handleListAgentTasks(
    _req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    return handleListAgentTasks(this._handlerCtx, _req, res);
  }

  private async handleExecuteAgentTask(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    return handleExecuteAgentTask(this._handlerCtx, req, res);
  }

  private async handleGetAgentProgress(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    agentId: string
  ): Promise<void> {
    return handleGetAgentProgress(this._handlerCtx, req, res, agentId);
  }

  // ========== Files Handlers ==========

  /**
   * 处理文件上传请求
   * 遵循「用户上传文件仅保存到用户目录」规则，使用 AttachmentManager 保存到 ~/.pyapp/attachments/
   */
  private async handleFileUpload(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    return handleFileUpload(this._handlerCtx, req, res);
  }

  private async handleConvertFile(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    return handleConvertFile(this._handlerCtx, req, res);
  }

  private async handleDetectFileType(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    return handleDetectFileType(this._handlerCtx, req, res);
  }

  private async handleSendFileToAI(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    return handleSendFileToAI(this._handlerCtx, req, res);
  }

  // ========== File Registry Handlers ==========

  /**
   * 处理文件列表查询请求 — 委托到 files-handlers.ts
   */
  private async handleFileRegistryList(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    return handleFileRegistryList(this._handlerCtx, req, res);
  }

  /**
   * 处理文件详情查询请求 — 委托到 files-handlers.ts
   */
  private async handleFileRegistryDetail(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    return handleFileRegistryDetail(this._handlerCtx, req, res);
  }

  /**
   * 处理文件全文搜索请求 — 委托到 files-handlers.ts
   */
  private async handleFileRegistrySearch(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    return handleFileRegistrySearch(this._handlerCtx, req, res);
  }

  /**
   * 处理文件统计请求 — 委托到 files-handlers.ts
   */
  private async handleFileRegistryStats(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    return handleFileRegistryStats(this._handlerCtx, req, res);
  }

  /**
   * 处理文件软删除请求 — 委托到 files-handlers.ts
   */
  private async handleFileRegistryDelete(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    return handleFileRegistryDelete(this._handlerCtx, req, res);
  }

  /**
   * 处理文件健康检查请求 — 委托到 files-handlers.ts
   */
  private async handleFileHealth(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    return handleFileHealth(this._handlerCtx, req, res);
  }

  // ========== Workspaces Handlers ==========

  /**
   * 处理列出工作空间请求
   * GET /v1/workspaces
   */
  private async handleListWorkspaces(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    return handleListWorkspaces(this._handlerCtx, req, res);
  }

  /**
   * 处理列出工作空间会话请求
   * GET /v1/workspaces/:id/sessions
   */
  private async handleListWorkspaceSessions(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    workspaceId: string
  ): Promise<void> {
    return handleListWorkspaceSessions(this._handlerCtx, req, res, workspaceId);
  }

  /**
   * 处理创建工作空间会话请求
   * POST /v1/workspaces/:id/sessions
   */
  private async handleCreateWorkspaceSession(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    workspaceId: string
  ): Promise<void> {
    return handleCreateWorkspaceSession(
      this._handlerCtx,
      req,
      res,
      workspaceId
    );
  }

  /**
   * 处理列出工作项请求
   * GET /v1/workspaces/:id/items
   */
  private async handleListWorkItems(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    workspaceId: string
  ): Promise<void> {
    return handleListWorkItems(this._handlerCtx, req, res, workspaceId);
  }

  /**
   * 处理创建工作项请求
   * POST /v1/workspaces/:id/items
   */
  private async handleCreateWorkItem(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    workspaceId: string
  ): Promise<void> {
    return handleCreateWorkItem(this._handlerCtx, req, res, workspaceId);
  }

  /**
   * 处理更新工作项请求
   * PATCH /v1/workspaces/:id/items/:itemId
   */
  private async handleUpdateWorkItem(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    workspaceId: string,
    itemId: string
  ): Promise<void> {
    return handleUpdateWorkItem(
      this._handlerCtx,
      req,
      res,
      workspaceId,
      itemId
    );
  }

  /**
   * 处理 .liri/ 目录检测请求（委派到 workspaces-handlers）
   */
  private async handleDetectLiriDir(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    workspaceId: string
  ): Promise<void> {
    return handleDetectLiriDir(this._handlerCtx, req, res, workspaceId);
  }

  /**
   * 处理 .liri/ 目录初始化请求（委派到 workspaces-handlers）
   */
  private async handleInitLiriDir(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    workspaceId: string
  ): Promise<void> {
    return handleInitLiriDir(this._handlerCtx, req, res, workspaceId);
  }

  /**
   * 处理获取工作空间配置请求（委派到 workspaces-handlers）
   */
  private async handleGetWorkspaceConfig(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    workspaceId: string
  ): Promise<void> {
    return handleGetWorkspaceConfig(this._handlerCtx, req, res, workspaceId);
  }

  /**
   * 处理更新工作空间配置请求（委派到 workspaces-handlers）
   */
  private async handleUpdateWorkspaceConfig(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    workspaceId: string
  ): Promise<void> {
    return handleUpdateWorkspaceConfig(this._handlerCtx, req, res, workspaceId);
  }

  /**
   * 处理获取工作空间规则请求（委派到 workspaces-handlers）
   */
  private async handleGetWorkspaceRules(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    workspaceId: string
  ): Promise<void> {
    return handleGetWorkspaceRules(this._handlerCtx, req, res, workspaceId);
  }

  /**
   * 处理更新工作空间规则请求（委派到 workspaces-handlers）
   */
  private async handleUpdateWorkspaceRules(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    workspaceId: string
  ): Promise<void> {
    return handleUpdateWorkspaceRules(this._handlerCtx, req, res, workspaceId);
  }

  /**
   * 列出工作项的变更集
   */
  private async handleListChangeSets(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    workspaceId: string,
    itemId: string
  ): Promise<void> {
    return handleListChangeSets(
      this._handlerCtx,
      req,
      res,
      workspaceId,
      itemId
    );
  }

  /**
   * 创建变更集
   */
  private async handleCreateChangeSet(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    workspaceId: string,
    itemId: string
  ): Promise<void> {
    return handleCreateChangeSet(
      this._handlerCtx,
      req,
      res,
      workspaceId,
      itemId
    );
  }

  /**
   * 获取变更集详情
   */
  private async handleGetChangeSet(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    workspaceId: string,
    changesetId: string
  ): Promise<void> {
    return handleGetChangeSet(
      this._handlerCtx,
      req,
      res,
      workspaceId,
      changesetId
    );
  }

  /**
   * 添加文件变更到变更集
   */
  private async handleAddFileChange(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    workspaceId: string,
    changesetId: string
  ): Promise<void> {
    return handleAddFileChange(
      this._handlerCtx,
      req,
      res,
      workspaceId,
      changesetId
    );
  }

  /**
   * 更新变更集状态（审核）
   */
  private async handleUpdateChangeSet(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    workspaceId: string,
    changesetId: string
  ): Promise<void> {
    return handleUpdateChangeSet(
      this._handlerCtx,
      req,
      res,
      workspaceId,
      changesetId
    );
  }

  /**
   * 获取变更集统计摘要
   */
  private async handleGetChangeSetSummary(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    workspaceId: string,
    changesetId: string
  ): Promise<void> {
    return handleGetChangeSetSummary(
      this._handlerCtx,
      req,
      res,
      workspaceId,
      changesetId
    );
  }

  // ========== Project Handlers ==========

  private async handleListProjects(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    workspaceId: string
  ): Promise<void> {
    return handleListProjects(this._handlerCtx, req, res, workspaceId);
  }

  private async handleCreateProject(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    workspaceId: string
  ): Promise<void> {
    return handleCreateProject(this._handlerCtx, req, res, workspaceId);
  }

  private async handleGetProject(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    workspaceId: string,
    projectId: string
  ): Promise<void> {
    return handleGetProject(this._handlerCtx, req, res, workspaceId, projectId);
  }

  private async handleUpdateProject(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    workspaceId: string,
    projectId: string
  ): Promise<void> {
    return handleUpdateProject(
      this._handlerCtx,
      req,
      res,
      workspaceId,
      projectId
    );
  }

  private async handleDeleteProject(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    workspaceId: string,
    projectId: string
  ): Promise<void> {
    return handleDeleteProject(
      this._handlerCtx,
      req,
      res,
      workspaceId,
      projectId
    );
  }

  private async handleGetProjectBoard(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    workspaceId: string,
    projectId: string
  ): Promise<void> {
    return handleGetProjectBoard(
      this._handlerCtx,
      req,
      res,
      workspaceId,
      projectId
    );
  }

  private async handleGetProjectRules(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    workspaceId: string,
    projectId: string
  ): Promise<void> {
    return handleGetProjectRules(
      this._handlerCtx,
      req,
      res,
      workspaceId,
      projectId
    );
  }

  private async handleUpdateProjectRules(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    workspaceId: string,
    projectId: string
  ): Promise<void> {
    return handleUpdateProjectRules(
      this._handlerCtx,
      req,
      res,
      workspaceId,
      projectId
    );
  }

  private async handleGetTemplates(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    workspaceId: string
  ): Promise<void> {
    return handleGetTemplates(this._handlerCtx, req, res, workspaceId);
  }

  private async handleCreateProjectWorkItem(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    workspaceId: string,
    projectId: string
  ): Promise<void> {
    return handleCreateProjectWorkItem(
      this._handlerCtx,
      req,
      res,
      workspaceId,
      projectId
    );
  }

  private async handleDecomposeProject(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    workspaceId: string,
    projectId: string
  ): Promise<void> {
    return handleDecomposeProject(
      this._handlerCtx,
      req,
      res,
      workspaceId,
      projectId
    );
  }

  /** GET /v1/tasks */
  private async handleListTasks(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    return handleListTasks(this._handlerCtx, req, res);
  }

  /** GET /v1/tasks/:taskId */
  private async handleGetTask(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    taskId: string
  ): Promise<void> {
    return handleGetTask(this._handlerCtx, req, res, taskId);
  }

  /** POST /v1/tasks */
  private async handleCreateTask(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    return handleCreateTask(this._handlerCtx, req, res);
  }

  /** PATCH /v1/tasks/:taskId */
  private async handleUpdateTask(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    taskId: string
  ): Promise<void> {
    return handleUpdateTask(this._handlerCtx, req, res, taskId);
  }

  /** DELETE /v1/tasks/:taskId */
  private async handleDeleteTask(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    taskId: string
  ): Promise<void> {
    return handleDeleteTask(this._handlerCtx, req, res, taskId);
  }

  /** GET /v1/tasks/:taskId/children */
  private async handleListTaskChildren(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    taskId: string
  ): Promise<void> {
    return handleListTaskChildren(this._handlerCtx, req, res, taskId);
  }

  // ========== Orchestration Handlers ==========

  private async handleOrchestrationStream(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    workspaceId: string,
    itemId: string
  ): Promise<void> {
    return handleOrchestrationStream(
      this._handlerCtx,
      req,
      res,
      workspaceId,
      itemId
    );
  }

  private async handleGetOrchestrationSnapshot(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    workspaceId: string,
    itemId: string
  ): Promise<void> {
    return handleGetOrchestrationSnapshot(
      this._handlerCtx,
      req,
      res,
      workspaceId,
      itemId
    );
  }

  private async handleGetOrchestrationHistory(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    workspaceId: string,
    itemId: string
  ): Promise<void> {
    return handleGetOrchestrationHistory(
      this._handlerCtx,
      req,
      res,
      workspaceId,
      itemId
    );
  }

  private async handleGetSwarmStatus(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    workspaceId: string
  ): Promise<void> {
    return handleGetSwarmStatus(this._handlerCtx, req, res, workspaceId);
  }

  private async handleGetAgentModelBindings(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    workspaceId: string
  ): Promise<void> {
    return handleGetAgentModelBindings(this._handlerCtx, req, res, workspaceId);
  }

  private async handleUpdateAgentModelBindings(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    workspaceId: string
  ): Promise<void> {
    return handleUpdateAgentModelBindings(
      this._handlerCtx,
      req,
      res,
      workspaceId
    );
  }

  // ========== Team Handlers ==========

  private async handleListTeams(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    workspaceId: string
  ): Promise<void> {
    return handleListTeams(this._handlerCtx, req, res, workspaceId);
  }

  private async handleCreateTeam(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    workspaceId: string
  ): Promise<void> {
    return handleCreateTeam(this._handlerCtx, req, res, workspaceId);
  }

  private async handleGetTeam(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    workspaceId: string,
    teamId: string
  ): Promise<void> {
    return handleGetTeam(this._handlerCtx, req, res, workspaceId, teamId);
  }

  private async handleUpdateTeam(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    workspaceId: string,
    teamId: string
  ): Promise<void> {
    return handleUpdateTeam(this._handlerCtx, req, res, workspaceId, teamId);
  }

  private async handleDeleteTeam(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    workspaceId: string,
    teamId: string
  ): Promise<void> {
    return handleDeleteTeam(this._handlerCtx, req, res, workspaceId, teamId);
  }

  private async handleAddTeamMember(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    workspaceId: string,
    teamId: string
  ): Promise<void> {
    return handleAddTeamMember(this._handlerCtx, req, res, workspaceId, teamId);
  }

  private async handleRemoveTeamMember(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    workspaceId: string,
    teamId: string,
    memberId: string
  ): Promise<void> {
    return handleRemoveTeamMember(
      this._handlerCtx,
      req,
      res,
      workspaceId,
      teamId,
      memberId
    );
  }

  private async handleUpdateMemberRole(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    workspaceId: string,
    teamId: string,
    memberId: string
  ): Promise<void> {
    return handleUpdateMemberRole(
      this._handlerCtx,
      req,
      res,
      workspaceId,
      teamId,
      memberId
    );
  }

  // ========== Cost Handlers ==========

  private async handleWorkspaceCostReport(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    workspaceId: string
  ): Promise<void> {
    return handleWorkspaceCostReport(this._handlerCtx, req, res, workspaceId);
  }

  private async handleWorkspaceBudgetStatus(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    workspaceId: string
  ): Promise<void> {
    return handleWorkspaceBudgetStatus(this._handlerCtx, req, res, workspaceId);
  }

  /**
   * 全局成本摘要（前端 Footer 使用）
   * GET /api/cost/summary
   */
  private async handleGlobalCostSummary(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      // [v1.2] 从 SQLite cost_records 聚合，不再读内存 CostTracker
      const { getCostRecordRepository } =
        await import('@modules/cost/CostRecordRepository');
      const repo = getCostRecordRepository();

      const now = Date.now();
      const todayStart = new Date();
      todayStart.setUTCHours(0, 0, 0, 0);
      const weekAgo = now - 7 * 24 * 60 * 60 * 1000;
      const monthAgo = now - 30 * 24 * 60 * 60 * 1000;

      // 并行查询（dailyRows 用缓存加速）
      const { getDailyCostCache } =
        await import('@modules/cost/DailyCostCache');
      const dailyCache = getDailyCostCache();

      // 模型 → 供应商名称映射（DB 唯一事实来源：model_registry.provider_id → providers.name）
      const { modelPricingService } =
        await import('@modules/ai/models/ModelPricingService');
      const { providerManager } =
        await import('@modules/ai/providers/ProviderManager');
      await Promise.all([
        modelPricingService.initialize(),
        providerManager.initialize(),
      ]);
      const [pricingAll, providers] = await Promise.all([
        modelPricingService.getAllPricing(),
        providerManager.listProviders(),
      ]);
      const providerNameById = new Map(providers.map((p) => [p.id, p.name]));
      const providerNameByModel = new Map<string, string>();
      for (const rec of pricingAll) {
        if (providerNameByModel.has(rec.modelId)) continue;
        const pName = providerNameById.get(rec.providerId);
        if (pName) providerNameByModel.set(rec.modelId, pName);
      }

      const [todayAgg, weekAgg, monthAgg, allAgg, dailyRows, sessionCount] =
        await Promise.all([
          repo.getAggregatedCosts({ startTime: todayStart.getTime() }),
          repo.getAggregatedCosts({ startTime: weekAgo }),
          repo.getAggregatedCosts({ startTime: monthAgo }),
          repo.getAggregatedCosts({}),
          dailyCache.get(repo, weekAgo),
          repo.countSessionSummaries(),
        ]);

      // 构建 topProviders（modelBreakdown 按模型键聚合 → 补充供应商名称；过滤零成本项）
      const topProviders = Object.entries(allAgg.modelBreakdown)
        .filter(([, data]) => data.totalCost > 0)
        .map(([modelKey, data]) => ({
          provider: modelKey,
          providerName: providerNameByModel.get(modelKey) || modelKey,
          cost: data.totalCost,
          inputTokens: data.inputTokens,
          outputTokens: data.outputTokens,
          totalTokens: data.totalTokens,
          requests: data.requestCount,
          percentage: 0,
        }))
        .sort((a, b) => b.cost - a.cost)
        .slice(0, 5);

      const topTotal = topProviders.reduce((s, p) => s + p.cost, 0);
      topProviders.forEach((p) => {
        p.percentage = topTotal > 0 ? (p.cost / topTotal) * 100 : 0;
      });

      const response = {
        totalSessions: sessionCount,
        todayCost: todayAgg.totalCostUSD,
        weeklyCost: weekAgg.totalCostUSD,
        monthlyCost: monthAgg.totalCostUSD,
        yearlyCost: allAgg.totalCostUSD,
        todayTokens: todayAgg.totalInputTokens + todayAgg.totalOutputTokens,
        monthlyTokens: monthAgg.totalInputTokens + monthAgg.totalOutputTokens,
        totalInputTokens: allAgg.totalInputTokens,
        totalOutputTokens: allAgg.totalOutputTokens,
        totalTokens: allAgg.totalInputTokens + allAgg.totalOutputTokens,
        totalCacheReadTokens: allAgg.totalCacheReadTokens,
        totalCacheCreationTokens: allAgg.totalCacheCreationTokens,
        totalRequests: allAgg.totalRequests,
        sessionCost: allAgg.totalCostUSD,
        sessionInputTokens: allAgg.totalInputTokens,
        sessionOutputTokens: allAgg.totalOutputTokens,
        sessionTokens: allAgg.totalInputTokens + allAgg.totalOutputTokens,
        topProviders,
        dailyBreakdown: dailyRows.map((d) => ({
          date: d.date,
          cost: d.cost,
          inputTokens: d.inputTokens,
          outputTokens: d.outputTokens,
          requests: d.requests,
        })),
      };

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(response));
    } catch (err) {
      await handleError(err, {
        module: 'infra:http',
        action: 'global_cost_summary',
      });
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: '获取成本摘要失败' } }));
    }
  }

  /**
   * 全局成本记录列表
   * GET /api/cost/records?page=&limit=
   */
  private async handleGlobalCostRecords(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      // [v1.2] 从 SQLite cost_records 读取真实记录
      const { getCostRecordRepository } =
        await import('@modules/cost/CostRecordRepository');
      const repo = getCostRecordRepository();

      const url = new URL(req.url || '', 'http://localhost');
      const page = parseInt(url.searchParams.get('page') || '1', 10);
      const limit = parseInt(url.searchParams.get('limit') || '20', 10);
      const offset = (page - 1) * limit;

      const records = await repo.getCostRecords({
        limit,
        offset,
      });

      const formatted = records.map((r) => ({
        id: r.id,
        date: new Date(r.timestamp).toISOString().split('T')[0],
        provider: r.model,
        model: r.model,
        promptTokens: r.inputTokens,
        completionTokens: r.outputTokens,
        totalTokens: r.inputTokens + r.outputTokens,
        cacheReadTokens: r.cacheReadTokens,
        cacheCreationTokens: r.cacheCreationTokens,
        cost: r.costUSD,
        currency: 'USD',
      }));

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ records: formatted, total: formatted.length }));
    } catch (err) {
      await handleError(err, {
        module: 'infra:http',
        action: 'global_cost_records',
      });
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: '获取成本记录失败' } }));
    }
  }

  /**
   * 按日期范围查询成本
   * GET /api/cost/range?startDate=&endDate=
   */
  private async handleGlobalCostRange(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      // [v1.2] 从 SQLite cost_records 按日期范围查询
      const { getCostRecordRepository } =
        await import('@modules/cost/CostRecordRepository');
      const repo = getCostRecordRepository();

      const url = new URL(req.url || '', 'http://localhost');
      const startDate = url.searchParams.get('startDate');
      const endDate = url.searchParams.get('endDate');

      const startTime = startDate ? new Date(startDate).getTime() : undefined;
      const endTime = endDate
        ? new Date(endDate + 'T23:59:59.999Z').getTime()
        : undefined;

      const records = await repo.getCostRecords({
        startTime,
        endTime,
      });

      const formatted = records.map((r) => ({
        id: r.id,
        date: new Date(r.timestamp).toISOString().split('T')[0],
        provider: r.model,
        model: r.model,
        promptTokens: r.inputTokens,
        completionTokens: r.outputTokens,
        totalTokens: r.inputTokens + r.outputTokens,
        cacheReadTokens: r.cacheReadTokens,
        cacheCreationTokens: r.cacheCreationTokens,
        cost: r.costUSD,
        currency: 'USD',
      }));

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(formatted));
    } catch (err) {
      await handleError(err, {
        module: 'infra:http',
        action: 'global_cost_range',
      });
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: '获取成本范围数据失败' } }));
    }
  }

  // ========== [v1.2] 对账 API ==========

  /**
   * 对账 model_usage_logs 与 cost_records
   * GET /api/cost/reconcile?startDate=&endDate=
   */
  private async handleCostReconcile(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      const { getCostRecordRepository } =
        await import('@modules/cost/CostRecordRepository');
      const repo = getCostRecordRepository();

      const url = new URL(req.url || '', 'http://localhost');
      const startDate = url.searchParams.get('startDate');
      const endDate = url.searchParams.get('endDate');

      const startTime = startDate ? new Date(startDate).getTime() : undefined;
      const endTime = endDate
        ? new Date(endDate + 'T23:59:59.999Z').getTime()
        : undefined;

      const result = await repo.reconcileUsageAndCost(startTime, endTime);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          ...result,
          total: result.matched + result.onlyInUsage + result.onlyInCost,
          matchRate:
            result.matched + result.onlyInUsage > 0
              ? (
                  (result.matched / (result.matched + result.onlyInUsage)) *
                  100
                ).toFixed(1) + '%'
              : 'N/A',
        })
      );
    } catch (err) {
      await handleError(err, {
        module: 'infra:http',
        action: 'cost_reconcile',
      });
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: '对账失败' } }));
    }
  }

  // ========== Work Item Search Handlers ==========

  private async handleSearchWorkItems(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    workspaceId: string
  ): Promise<void> {
    return handleSearchWorkItems(this._handlerCtx, req, res, workspaceId);
  }

  private async handleWorkItemReview(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    workspaceId: string
  ): Promise<void> {
    return handleWorkItemReview(this._handlerCtx, req, res, workspaceId);
  }

  // ========== Workflow Template Handlers ==========

  private async handleListWorkflowTemplates(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    return handleListWorkflowTemplates(this._handlerCtx, req, res);
  }

  private async handleGetWorkflowTemplate(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    templateId: string
  ): Promise<void> {
    return handleGetWorkflowTemplate(this._handlerCtx, req, res, templateId);
  }

  private async handleCreateWorkflowTemplate(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    return handleCreateWorkflowTemplate(this._handlerCtx, req, res);
  }

  private async handleUpdateWorkflowTemplate(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    templateId: string
  ): Promise<void> {
    return handleUpdateWorkflowTemplate(this._handlerCtx, req, res, templateId);
  }

  private async handleDeleteWorkflowTemplate(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    templateId: string
  ): Promise<void> {
    return handleDeleteWorkflowTemplate(this._handlerCtx, req, res, templateId);
  }

  /**
   * Council 相关处理器
   */
  private async handleCreateCouncil(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    workspaceId: string
  ): Promise<void> {
    return handleCreateCouncil(this._handlerCtx, req, res, workspaceId);
  }

  private async handleGetCouncil(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    sessionId: string
  ): Promise<void> {
    return handleGetCouncil(this._handlerCtx, req, res, sessionId);
  }

  private async handleCouncilStream(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    sessionId: string
  ): Promise<void> {
    return handleCouncilStream(this._handlerCtx, req, res, sessionId);
  }

  private async handleListCouncils(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    workspaceId: string
  ): Promise<void> {
    return handleListCouncils(this._handlerCtx, req, res, workspaceId);
  }

  private async handleSubmitStatement(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    sessionId: string
  ): Promise<void> {
    return handleSubmitStatement(this._handlerCtx, req, res, sessionId);
  }

  /**
   * 编排智能处理器
   */
  private async handleImpactAnalysis(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    return handleImpactAnalysis(this._handlerCtx, req, res);
  }

  private async handleRiskDetection(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    return handleRiskDetection(this._handlerCtx, req, res);
  }

  private async handleDecisionClassify(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    return handleDecisionClassify(this._handlerCtx, req, res);
  }

  private async handleEscalation(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    return handleEscalation(this._handlerCtx, req, res);
  }

  private async handleGetEscalations(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    return handleGetEscalations(this._handlerCtx, req, res);
  }

  private async handleResourceSchedule(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    return handleResourceSchedule(this._handlerCtx, req, res);
  }

  private async handleGetResources(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    return handleGetResources(this._handlerCtx, req, res);
  }

  /**
   * 规则管理处理器
   */
  private async handleListRules(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    workspaceId: string
  ): Promise<void> {
    return handleListRules(this._handlerCtx, req, res, workspaceId);
  }

  private async handleGetRule(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    specialization: string
  ): Promise<void> {
    return handleGetRule(
      this._handlerCtx,
      req,
      res,
      specialization as RuleSpecialization
    );
  }

  private async handleWriteRule(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    specialization: string
  ): Promise<void> {
    return handleWriteRule(
      this._handlerCtx,
      req,
      res,
      specialization as RuleSpecialization
    );
  }

  private async handleAppendRule(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    specialization: string
  ): Promise<void> {
    return handleAppendRule(
      this._handlerCtx,
      req,
      res,
      specialization as RuleSpecialization
    );
  }

  private async handleLoadRulesForWorkItem(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    return handleLoadRulesForWorkItem(this._handlerCtx, req, res);
  }

  private async handleRulesOverview(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    return handleRulesOverview(this._handlerCtx, req, res);
  }

  /**
   * 瓶颈感知处理器
   */
  private async handleBottleneckAnalysis(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    return handleBottleneckAnalysis(this._handlerCtx, req, res);
  }

  /**
   * 处理列出知识条目请求（委派到 knowledge-handlers）
   */
  private async handleListKnowledge(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    return handleListKnowledge(req, res);
  }

  /**
   * 处理搜索知识条目请求（委派到 knowledge-handlers）
   */
  private async handleSearchKnowledge(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    return handleSearchKnowledge(req, res);
  }

  /**
   * 处理创建知识条目请求（委派到 knowledge-handlers）
   */
  private async handleCreateKnowledge(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    return handleCreateKnowledge(req, res);
  }

  /**
   * 处理更新知识条目请求（委派到 knowledge-handlers）
   */
  private async handleUpdateKnowledge(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    knowledgeId: string
  ): Promise<void> {
    return handleUpdateKnowledge(req, res, knowledgeId);
  }

  /**
   * 处理删除知识条目请求（委派到 knowledge-handlers）
   */
  private async handleDeleteKnowledge(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    knowledgeId: string
  ): Promise<void> {
    return handleDeleteKnowledge(req, res, knowledgeId);
  }

  /**
   * 处理列出知识库请求（委派到 knowledge-handlers）
   */
  private async handleListKnowledgeBases(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    return handleListKnowledgeBases(req, res);
  }

  /**
   * 处理创建知识库请求（委派到 knowledge-handlers）
   */
  private async handleCreateKnowledgeBase(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    return handleCreateKnowledgeBase(req, res);
  }

  /**
   * 处理更新知识库请求（委派到 knowledge-handlers）
   */
  private async handleUpdateKnowledgeBase(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    baseName: string
  ): Promise<void> {
    return handleUpdateKnowledgeBase(req, res, baseName);
  }

  /**
   * 处理删除知识库请求（委派到 knowledge-handlers）
   */
  private async handleDeleteKnowledgeBase(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    baseName: string
  ): Promise<void> {
    return handleDeleteKnowledgeBase(req, res, baseName);
  }

  private async handleCloneKnowledgeBase(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    baseName: string
  ): Promise<void> {
    return handleCloneKnowledgeBase(req, res, baseName);
  }

  private async handleDuplicateKnowledgeBase(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    baseName: string
  ): Promise<void> {
    return handleDuplicateKnowledgeBase(req, res, baseName);
  }

  /**
   * 处理从聊天保存知识请求（委派到 knowledge-handlers）
   */
  private async handleSaveFromChat(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    return handleSaveFromChat(req, res);
  }

  /**
   * 处理知识上传请求（委派到 knowledge-handlers）
   */
  private async handleKnowledgeUpload(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    return handleKnowledgeUpload(req, res);
  }

  /**
   * 处理知识编译请求（委派到 knowledge-handlers）
   */
  private async handleKnowledgeCompile(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    return handleKnowledgeCompile(req, res);
  }

  /**
   * W9: 处理编译进度查询（委派到 knowledge-handlers）
   */
  private async handleKnowledgeCompileStatus(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    return handleKnowledgeCompileStatus(req, res);
  }

  /**
   * 处理获取原始文件列表请求（委派到 knowledge-handlers）
   */
  private async handleGetRawFiles(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    return handleGetRawFiles(req, res);
  }

  /**
   * 处理知识库健康检查（委派到 knowledge-handlers）
   */
  private async handleKnowledgeHealth(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    return handleKnowledgeHealth(req, res);
  }

  /**
   * 处理导出到笔记本请求（委派到 knowledge-handlers）
   */
  private async handleExportToNotebook(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    return handleExportToNotebook(req, res);
  }

  /**
   * 处理从文件导入请求（委派到 knowledge-handlers）
   */
  private async handleImportFromFile(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    return handleImportFromFile(req, res);
  }

  /**
   * 处理更新知识文档请求（委派到 knowledge-handlers）
   */
  private async handleUpdateKnowledgeDoc(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    return handleUpdateKnowledgeDoc(req, res);
  }

  /**
   * 处理批量删除知识条目请求（委派到 knowledge-handlers）
   */
  private async handleBatchDeleteKnowledge(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    return handleBatchDeleteKnowledge(req, res);
  }

  /**
   * 处理批量标记知识条目请求（委派到 knowledge-handlers）
   */
  private async handleBatchTagKnowledge(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    return handleBatchTagKnowledge(req, res);
  }

  /**
   * 处理列出快照请求（委派到 knowledge-handlers）
   */
  private async handleListSnapshots(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    return handleListSnapshots(req, res);
  }

  /**
   * 处理快照恢复请求（委派到 knowledge-handlers）
   */
  private async handleRestoreSnapshot(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    return handleRestoreSnapshot(req, res);
  }

  /**
   * 处理移至回收站请求
   */
  private async handleTrashKnowledge(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    return handleTrashKnowledge(req, res);
  }

  /**
   * 处理从回收站恢复请求
   */
  private async handleRestoreTrash(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    return handleRestoreTrash(req, res);
  }

  /**
   * 处理知识库ZIP导出请求
   */
  private async handleExportKnowledge(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    return handleExportKnowledge(req, res);
  }

  // ---- FAQ Handlers ----

  private async handleListFAQ(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    return handleListFAQ(req, res);
  }

  private async handleCreateFAQ(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    return handleCreateFAQ(req, res);
  }

  private async handleUpdateFAQ(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    return handleUpdateFAQ(req, res);
  }

  private async handleDeleteFAQ(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    return handleDeleteFAQ(req, res);
  }

  private async handleBatchDeleteFAQ(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    return handleBatchDeleteFAQ(req, res);
  }

  private async handleImportFAQ(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    return handleImportFAQ(req, res);
  }

  private async handleSearchFAQ(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    return handleSearchFAQ(req, res);
  }

  private async handleFAQCategories(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    return handleFAQCategories(req, res);
  }

  // ========== Buddy Handlers ==========

  /**
   * 处理获取 Buddy 伙伴信息请求
   */
  private async handleGetBuddy(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    return handleGetBuddy(this._handlerCtx, req, res);
  }

  private async handleBuddyInteract(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    return handleBuddyInteract(this._handlerCtx, req, res);
  }

  private async handleGetBuddyStats(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    return handleGetBuddyStats(this._handlerCtx, req, res);
  }

  private async handleGetDreamLogs(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    return handleGetDreamLogs(this._handlerCtx, req, res);
  }

  // ========== Config Handlers ==========

  /**
   * 处理 favicon 请求 — 返回 204 避免 404 控制台噪声
   */
  private handleFavicon(
    _req: http.IncomingMessage,
    res: http.ServerResponse
  ): void {
    res.writeHead(204);
    res.end();
  }

  /**
   * 处理列出所有配置请求
   */
  private async handleListConfig(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      const { configManager } = await import('@modules/config/ConfigManager');
      const globalConfig = configManager.getGlobalConfig();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(globalConfig || {}));
    } catch (_err) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({}));
    }
  }

  /**
   * 处理获取指定配置项请求
   */
  private async handleGetConfig(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    key: string
  ): Promise<void> {
    try {
      const { configManager } = await import('@modules/config/ConfigManager');
      const value = configManager.getConfigValue(key);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ key, value }));
    } catch (_err) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ key, value: null }));
    }
  }

  /**
   * 处理设置配置项请求
   */
  private async handleSetConfig(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    key: string
  ): Promise<void> {
    try {
      const body = await this.readRequestBody(req);
      const { value } = JSON.parse(body);
      const { configManager } = await import('@modules/config/ConfigManager');
      configManager.setConfigValue(key, value);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, key, value }));
      this.broadcastEvent('config:updated', { key, value });
    } catch (err) {
      this.sendError(res, err);
    }
  }

  private async handleDeleteConfig(
    _req: http.IncomingMessage,
    res: http.ServerResponse,
    key: string
  ): Promise<void> {
    try {
      const { configManager } = await import('@modules/config/ConfigManager');
      // ConfigManager 没有 deleteConfigValue，通过 saveGlobalConfig 移除 key
      const { getConfig } = await import('@modules/config');
      const current = { ...(getConfig() as Record<string, unknown>) };
      delete current[key];
      configManager.setConfigValue(key, undefined as unknown);
      // 广播变更
      this.broadcastEvent('config:deleted', { key });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, key }));
    } catch (err) {
      this.sendError(res, err);
    }
  }

  // ========== 统一设置端点 ==========

  /**
   * 获取命名空间设置
   * GET /v1/settings/{namespace}
   */
  private async handleGetSettings(
    _req: http.IncomingMessage,
    res: http.ServerResponse,
    namespace: string
  ): Promise<void> {
    try {
      const { configManager } = await import('@modules/config/ConfigManager');
      const settingsKey = `settings.${namespace}`;
      const value = configManager.getConfigValue(settingsKey);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ namespace, value: value ?? {} }));
    } catch {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ namespace, value: {} }));
    }
  }

  /**
   * 设置命名空间配置
   * PUT /v1/settings/{namespace}
   */
  private async handleSetSettings(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    namespace: string
  ): Promise<void> {
    try {
      const body = await this.readRequestBody(req);
      const values = JSON.parse(body || '{}');
      const { configManager } = await import('@modules/config/ConfigManager');
      const settingsKey = `settings.${namespace}`;
      configManager.setConfigValue(settingsKey, values);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, namespace, value: values }));
    } catch (err) {
      this.sendError(res, err);
    }
  }

  // ========== Router（智能路由）==========

  /**
   * 获取 SmartRouter 当前配置与最近一次路由决策
   */
  private async handleRouterGetConfig(
    _req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      const { getCoreAPI } = await import('@modules/runtime/api/CoreAPIImpl');
      const core = getCoreAPI();
      const router = core.getSmartRouter();

      const config = router?.getConfig() || null;
      const lastDecision = core.getLastRouteDecision();

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          success: true,
          data: {
            enabled: config?.enabled ?? false,
            config,
            lastDecision,
            active: router !== null,
          },
        })
      );
    } catch (err) {
      this.sendError(res, err);
    }
  }

  /**
   * 更新 SmartRouter 配置（运行时动态切换）
   */
  private async handleRouterUpdateConfig(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      const body = await this.readRequestBody(req);
      const { config } = JSON.parse(body);
      const { getCoreAPI } = await import('@modules/runtime/api/CoreAPIImpl');
      const core = getCoreAPI();
      const router = core.getSmartRouter();

      if (!router) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({ success: false, error: 'SmartRouter 未初始化' })
        );
        return;
      }

      router.updateConfig(config);
      this.broadcastEvent('router:updated', { config });

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true }));
    } catch (err) {
      this.sendError(res, err);
    }
  }

  // ========== SSE Event Bus (extracted to LocalHTTPServiceSSE.ts) ==========

  /**
   * 处理 SSE 事件订阅 — 委托给 LocalHTTPServiceSSE.handleEvents
   * 修复: 原实现误委托给 config-handlers 的 handleEvents（独立 clients Set），
   * 导致 /v1/events 客户端与 broadcastEvent 广播的客户端集合不一致，事件永不送达前端。
   */
  private async handleEvents(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    return handleEvents(req, res);
  }

  /**
   * 广播事件到所有 SSE 客户端 — 委托给 LocalHTTPServiceSSE.broadcastEvent
   */
  private broadcastEvent(event: string, data: Record<string, unknown>): void {
    return broadcastEvent(event, data);
  }

  // ========== Error Helper ==========

  /**
   * 发送错误响应 — 委托给 handler-utils
   */
  private sendError(
    res: http.ServerResponse,
    err: unknown,
    status = 500
  ): void {
    return this._handlerCtx.sendError(res, err, status);
  }

  /**
   * 检查文件路径是否在允许的白名单范围内 — 委托给 handler-utils
   */
  private checkFilePathPermission(
    filePath: string,
    permission: SandboxPermission
  ): boolean {
    return this._handlerCtx.checkFilePathPermission(filePath, permission);
  }

  /**
   * 读取请求体 — 委托给 handler-utils
   */
  private readRequestBody(req: http.IncomingMessage): Promise<string> {
    return this._handlerCtx.readRequestBody(req);
  }

  /**
   * 获取当前用户数据目录 GET /v1/settings/data-directory
   */
  private async handleGetDataDirectory(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      const {
        resolvePyappHome,
        getUserDataDirOverride,
        setUserDataDirOverride,
      } = await import('@modules/core/paths');

      const currentDir = resolvePyappHome();
      const configuredDir = getUserDataDirOverride();
      // 获取原始默认值（临时清除覆盖，计算后恢复）
      const savedOverride = getUserDataDirOverride();
      if (savedOverride) setUserDataDirOverride(null);
      const defaultDir = resolvePyappHome();
      if (savedOverride) setUserDataDirOverride(savedOverride);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          currentDirectory: currentDir,
          configuredDirectory: configuredDir || null,
          defaultDirectory: defaultDir,
        })
      );
    } catch (error) {
      this.sendError(res, error);
    }
  }

  // ========== Commands Handlers ==========

  /**
   * 处理列出所有命令请求 GET /v1/commands
   */
  private async handleListCommands(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      const { getCommandManager } = await import('@modules/commands');
      const commandManager = getCommandManager();
      const commands = await commandManager.getAllCommands();
      const result = commands.map((cmd) => ({
        name: cmd.name,
        description: cmd.description,
        aliases: cmd.aliases || [],
        argumentHint: cmd.argumentHint || '',
        userInvocable: cmd.userInvocable !== false,
      }));
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(result));
    } catch (err) {
      this.sendError(res, err);
    }
  }

  /**
   * 处理执行命令请求 POST /v1/commands/execute
   */
  private async handleExecuteCommand(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      const body = await this.readRequestBody(req);
      if (!body) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({ error: { message: 'request body is required' } })
        );
        return;
      }

      let parsedBody;
      try {
        parsedBody = JSON.parse(body);
      } catch (_err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({ error: { message: 'invalid JSON in request body' } })
        );
        return;
      }

      const { command } = parsedBody;

      if (!command) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'command is required' } }));
        return;
      }

      const { commandExecutor } =
        await import('@modules/commands/executor/CommandExecutor.js');
      const result = await commandExecutor.execute(command);

      const output =
        result.value?.toString() || result.message?.toString() || '';
      const error = result.type === 'error' ? output : '';

      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(
        JSON.stringify({
          success: result.success !== false,
          output,
          error,
        })
      );
    } catch (err) {
      this.sendError(res, err);
    }
  }

  /**
   * 递归复制目录（带回滚令牌）
   * @param src 源目录
   * @param dest 目标目录
   * @param fs fs 模块
   * @param path path 模块
   * @returns 复制结果统计
   */
  private copyDirectory(
    src: string,
    dest: string,
    fs: {
      existsSync(p: string): boolean;
      mkdirSync(p: string, opts?: { recursive?: boolean }): void;
      readdirSync(
        p: string,
        opts?: { withFileTypes?: boolean }
      ): Array<{ name: string; isDirectory(): boolean }>;
      copyFileSync(src: string, dest: string): void;
    },
    path: { join(...segments: string[]): string }
  ): { copied: number; skipped: number; errors: string[] } {
    let copied = 0;
    let skipped = 0;
    const errors: string[] = [];

    if (!fs.existsSync(src)) {
      return { copied, skipped, errors };
    }

    if (!fs.existsSync(dest)) {
      fs.mkdirSync(dest, { recursive: true });
    }

    const entries = fs.readdirSync(src, { withFileTypes: true });

    for (const entry of entries) {
      // 跳过迁移标记文件本身，避免误复制
      if (
        entry.name === '.migrating' ||
        entry.name === '.migration_committed'
      ) {
        continue;
      }
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);

      try {
        if (entry.isDirectory()) {
          const result = this.copyDirectory(srcPath, destPath, fs, path);
          copied += result.copied;
          skipped += result.skipped;
          errors.push(...result.errors);
        } else {
          if (!fs.existsSync(destPath)) {
            fs.copyFileSync(srcPath, destPath);
            copied++;
          } else {
            skipped++;
          }
        }
      } catch (err) {
        errors.push(`复制 ${srcPath} 失败: ${(err as Error).message}`);
      }
    }

    return { copied, skipped, errors };
  }

  /**
   * 设置用户数据目录 PUT /v1/settings/data-directory
   * 使用两阶段迁移：全部复制成功后才切换目录，复制失败则回滚清理
   * @param req
   * @param res
   * @param options.migrate 是否迁移现有数据（默认 true）
   */
  private async handleSetDataDirectory(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      const body = await this.readRequestBody(req);
      const payload = JSON.parse(body);
      const { directory, migrate = true } = payload;

      if (!directory || typeof directory !== 'string') {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            error: {
              message: '目录路径不能为空',
              type: 'invalid_request_error',
            },
          })
        );
        return;
      }

      const fs = await import('fs');
      const path = await import('path');
      const resolvedDir = path.resolve(directory);

      // 验证目录可写
      try {
        if (!fs.existsSync(resolvedDir)) {
          fs.mkdirSync(resolvedDir, { recursive: true });
        }
        const testFile = path.join(resolvedDir, '.write_test');
        fs.writeFileSync(testFile, '');
        fs.unlinkSync(testFile);
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            error: {
              message: `无法创建或写入目录: ${(err as Error).message}`,
              type: 'invalid_request_error',
            },
          })
        );
        return;
      }

      // 获取当前数据目录
      const { resolvePyappHome, setUserDataDirOverride } =
        await import('@modules/core/paths');
      const currentDir = resolvePyappHome();

      // 执行数据迁移（两阶段：先复制，成功后再切换）
      let migrationResult: {
        copied: number;
        skipped: number;
        errors: string[];
      } | null = null;
      if (migrate && currentDir !== resolvedDir && fs.existsSync(currentDir)) {
        // 阶段一：写迁移令牌，标记迁移进行中
        try {
          fs.writeFileSync(
            path.join(resolvedDir, '.migrating'),
            Date.now().toString(),
            'utf-8'
          );
        } catch (_err) {
          // 非致命：令牌写入失败不影响迁移
        }

        migrationResult = this.copyDirectory(currentDir, resolvedDir, fs, path);

        // 检查迁移是否出错，出错则执行回滚
        if (migrationResult.errors.length > 0) {
          this.rollbackMigration(resolvedDir, fs, path, currentDir);

          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              success: false,
              message: `数据迁移失败，已回滚，保留了 ${migrationResult.copied} 个已复制的文件作为备份参考`,
              directory: resolvedDir,
              migration: migrationResult,
              rolledBack: true,
              error: {
                message: `迁移过程中出现 ${migrationResult.errors.length} 个错误，目录已回滚`,
                type: 'migration_error',
              },
            })
          );
          return;
        }

        // 阶段二：写迁移完成标记
        try {
          fs.writeFileSync(
            path.join(resolvedDir, '.migration_committed'),
            Date.now().toString(),
            'utf-8'
          );
        } catch (_err) {
          // 非致命：标记写入失败不影响目录切换
        }
      }

      // 设置全局覆盖
      setUserDataDirOverride(resolvedDir);

      // 持久化：ConfigManager（新） + settings.json（向后兼容）
      const { configManager } = await import('@modules/config/ConfigManager');
      configManager.setConfigValue('system.dataDirectory', resolvedDir);
      const { updateUserSettings } =
        await import('@modules/config/settings/userSettings');
      await updateUserSettings({ dataDirectory: resolvedDir });

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          success: true,
          message: migrationResult
            ? `数据目录已更新，已迁移 ${migrationResult.copied} 个文件，跳过 ${migrationResult.skipped} 个文件`
            : '数据目录已更新',
          directory: resolvedDir,
          migration: migrationResult,
        })
      );
    } catch (error) {
      this.sendError(res, error);
    }
  }

  /**
   * 回滚数据迁移：删除目标目录中的已复制内容
   * @param destDir 目标目录（将被清理）
   * @param fs fs 模块
   * @param path path 模块
   * @param oldDir 原数据目录（保留不动）
   */
  private rollbackMigration(
    destDir: string,
    fs: {
      existsSync(p: string): boolean;
      readdirSync(
        p: string,
        opts?: { withFileTypes?: boolean }
      ): Array<{ name: string; isDirectory(): boolean }>;
      rmSync(p: string, opts?: { recursive?: boolean; force?: boolean }): void;
      unlinkSync(p: string): void;
    },
    path: { join(...segments: string[]): string },
    _oldDir: string
  ): void {
    try {
      // 清理目标目录中除 .migrating 令牌外的所有文件和子目录
      if (fs.existsSync(destDir)) {
        const entries = fs.readdirSync(destDir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.name === '.migrating') continue;
          const entryPath = path.join(destDir, entry.name);
          try {
            if (entry.isDirectory()) {
              fs.rmSync(entryPath, { recursive: true, force: true });
            } else {
              fs.unlinkSync(entryPath);
            }
          } catch (_err) {
            // 静默忽略清理中的个别错误
          }
        }
      }
    } catch (_err) {
      // 回滚清理失败不影响主流程，数据保留在原目录
    }
  }

  // ──────────────────────────────────────────────
  // Skills（ClawHub 生态对接）处理器
  // ──────────────────────────────────────────────

  /**
   * 技能写盘后重载用户技能 registry（2026-08-06）
   * 使 LLM 通过 SkillTool 同步 / SkillInjectionService 注入立即可感知新建技能，无需重启。
   */
  private async reloadUserSkillsAfterWrite(): Promise<void> {
    try {
      const { reloadUserSkills } =
        await import('@modules/constants/systemPromptSections');
      await reloadUserSkills();
    } catch (err) {
      logger.warning('用户技能重载失败（不影响已落盘文件）', {
        error: String(err),
      });
    }
  }

  /**
   * 获取 ClawHubAdapter 实例（v1.5 阶段 3：instanceof 运行时收窄替代 as unknown as 断言）
   * 优先从 ThirdPartyAdapterRegistry 获取，fallback 到直接 import
   */
  private async getClawHubAdapter(): Promise<ClawHubAdapterLike> {
    const { ClawHubAdapter } =
      await import('@modules/skills/loaders/adapter/clawhub/ClawHubAdapter');

    // 优先从注册表获取（instanceof 收窄到真实类型；initialize 幂等）
    try {
      const { thirdPartyAdapterRegistry } =
        await import('@modules/skills/loaders/adapter/ThirdPartyAdapterRegistry');
      const registered = thirdPartyAdapterRegistry.get('clawhub');
      if (registered instanceof ClawHubAdapter) {
        await registered.initialize();
        return registered;
      }
    } catch (_err) {
      // 注册表不可用时 fallback
    }

    // Fallback: 单例
    const adapter = ClawHubAdapter.getInstance();
    await adapter.initialize();

    return adapter;
  }

  /**
   * 处理列出已安装技能请求 GET /v1/skills
   */
  private async handleListSkills(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      const adapter = await this.getClawHubAdapter();
      const skills = await adapter.getInstalledSkills();

      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ skills }));
    } catch (err) {
      this.sendError(res, err);
    }
  }

  /**
   * 处理列出系统内置技能请求 GET /v1/skills/system
   * 扫描 builtin/skills 和用户技能目录中的 SKILL.md 文件，
   * 返回与前端 SkillPage 兼容的技能列表
   */
  private async handleListSystemSkills(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      const { resolveProjectRoot, resolvePyappHome } =
        await import('@modules/core/paths');
      const { parseSkillFrontmatter } =
        await import('@modules/skills/utils/skillParser');
      const { readdir, readFile, stat } = await import('fs/promises');
      const { existsSync, readFileSync } = await import('fs');
      const { join } = await import('path');

      // 5.6：status 反映真实启用状态 —— 本地技能（导入审批 .enabled 标记）优先，其次 registry
      const adapter = await this.getClawHubAdapter();
      const registry = adapter.getSkillRegistry();
      const userSkillsDir = join(resolvePyappHome(), 'skills');
      const resolveStatus = (name: string): string => {
        try {
          // 本地技能：.enabled 文件为导入权限审批标记（true/false）
          const enabledFile = join(userSkillsDir, name, '.enabled');
          if (existsSync(enabledFile)) {
            return readFileSync(enabledFile, 'utf-8').trim() === 'true'
              ? 'enabled'
              : 'disabled';
          }
          // registry 真实状态（内置/市场技能）
          const skill = registry?.get(name, { includeDisabled: true });
          if (skill && skill.isEnabled && !skill.isEnabled()) {
            return 'disabled';
          }
        } catch {
          // 状态解析异常时默认 enabled
        }
        return 'enabled';
      };

      const skills: Record<string, unknown>[] = [];
      const seen = new Set<string>();

      const scanDir = async (
        dir: string,
        source: string,
        opts?: {
          /** 排除的子目录名（如 vendor，避免第三方技能被误标为 user） */
          exclude?: string[];
        }
      ) => {
        if (!existsSync(dir)) return;
        const entries = await readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (opts?.exclude?.includes(entry.name)) continue;
          // 子目录：查找 SKILL.md
          if (entry.isDirectory()) {
            const skillDir = join(dir, entry.name);
            const skillMdPath = join(skillDir, 'SKILL.md');
            try {
              await stat(skillMdPath); // 检查 SKILL.md 是否存在
              const content = await readFile(skillMdPath, 'utf-8');
              const parsed = parseSkillFrontmatter(content);
              const name = entry.name;
              const description = parsed.frontmatter?.description || '';
              const fm = parsed.frontmatter as Record<string, unknown>;
              const version = fm?.version || '1.0.0';
              const author = fm?.author || '';
              const category = fm?.category || 'general';

              if (seen.has(name)) continue;
              seen.add(name);

              let createdAt = 0;
              let updatedAt = 0;
              try {
                const st = await stat(skillMdPath);
                createdAt = st.birthtimeMs;
                updatedAt = st.mtimeMs;
              } catch (_err) {
                /* use defaults */
              }

              skills.push({
                id: name,
                name,
                description,
                status: resolveStatus(name),
                category,
                parameters: [],
                createdAt,
                updatedAt,
                usageCount: 0,
                lastUsedAt: null,
                source,
                version,
                filePath: skillMdPath,
                frontmatter: { author, version, category },
              });
            } catch (_err) {
              // 没有 SKILL.md 的子目录跳过
              continue;
            }
            continue;
          }

          // 根目录下的 .md 文件（兼容旧结构）
          if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
          const filePath = join(dir, entry.name);
          try {
            const content = await readFile(filePath, 'utf-8');
            const parsed = parseSkillFrontmatter(content);
            const name = entry.name.replace(/\.md$/, '');
            const description = parsed.frontmatter?.description || '';
            const fm = parsed.frontmatter as Record<string, unknown>;
            const version = fm?.version || '1.0.0';
            const author = fm?.author || '';
            const category = fm?.category || 'general';

            if (seen.has(name)) continue;
            seen.add(name);

            let createdAt = 0;
            let updatedAt = 0;
            try {
              const st = await stat(filePath);
              createdAt = st.birthtimeMs;
              updatedAt = st.mtimeMs;
            } catch (_err) {
              /* use defaults */
            }

            skills.push({
              id: name,
              name,
              description,
              status: resolveStatus(name),
              category,
              parameters: [],
              createdAt,
              updatedAt,
              usageCount: 0,
              lastUsedAt: null,
              source,
              version,
              filePath,
              frontmatter: { author, version, category },
            });
          } catch (_err) {
            /* skip malformed files */
          }
        }
      };

      // 扫描内置技能
      const projectRoot = resolveProjectRoot();
      const builtinDir = join(projectRoot, 'app', 'src', 'builtin', 'skills');
      await scanDir(builtinDir, 'builtin');

      // 扫描用户技能（userSkillsDir 已在 resolveStatus 前声明）
      // 2026-08-06：排除 vendor 子目录（第三方技能独立，避免误标为 user）
      await scanDir(userSkillsDir, 'user', { exclude: ['vendor'] });

      // 2026-08-06：扫描第三方技能（~/.pyapp/skills/vendor/），标为 third_party
      const { resolveVendorSkillsDir } = await import('@modules/core/paths');
      await scanDir(resolveVendorSkillsDir(), 'third_party');

      // 2026-08-06：补充 BundledSkillLoader 注册的内置技能（BUILTIN 源，程序化定义非 SKILL.md 文件）
      // 归一化：按 skill.source 映射真实来源（builtin/official/third_party），不再硬编码 builtin
      try {
        const { skillRegistry: builtinRegistry } =
          await import('@modules/constants/systemPromptSections');
        for (const skill of builtinRegistry.getAll({ includeDisabled: true })) {
          if (seen.has(skill.name)) continue;
          seen.add(skill.name);
          const sourceMap: Record<string, string> = {
            builtin: 'builtin',
            official: 'official',
            third_party: 'third_party',
          };
          skills.push({
            id: skill.name,
            name: skill.name,
            description: skill.description || '',
            status: resolveStatus(skill.name),
            category: 'general',
            parameters: [],
            createdAt: 0,
            updatedAt: 0,
            usageCount: 0,
            lastUsedAt: null,
            source: sourceMap[String(skill.source)] || 'builtin',
            version: skill.version || '1.0.0',
            filePath: `registry:${skill.name}`,
            frontmatter: {
              author: '',
              version: skill.version || '1.0.0',
              category: 'general',
            },
          });
        }
      } catch (_err) {
        // @ignore-catch: 内置技能注册表不可用时跳过（不阻断用户技能列表）
      }

      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ skills, total: skills.length }));
    } catch (err) {
      this.sendError(res, err);
    }
  }

  /**
   * 校验技能 ID（解码后），非法时写入 400 响应并返回 null（S0-1 统一入口）
   */
  private async validateSkillIdParam(
    rawId: string,
    res: http.ServerResponse
  ): Promise<string | null> {
    const { validateSkillId } =
      await import('@modules/skills/loaders/adapter/safeSkillId');
    const decoded = decodeURIComponent(rawId);
    const idError = validateSkillId(decoded);
    if (idError) {
      res.writeHead(400, {
        'Content-Type': 'application/json; charset=utf-8',
      });
      res.end(
        JSON.stringify({
          error: { code: 'INVALID_PARAM', message: idError },
        })
      );
      return null;
    }
    return decoded;
  }

  /**
   * 校验技能内相对文件路径（S0-2：拦截 .. / 绝对路径 / Windows 保留名，逐段复用 safeSkillId）
   * @returns 错误消息（合法返回 null）
   */
  private async skillRelError(rel: string): Promise<string | null> {
    if (!rel) return '空路径';
    const normalized = rel.replace(/\\/g, '/');
    if (normalized.includes('..')) return `非法条目路径: ${rel}`;
    if (path.isAbsolute(normalized) || /^[a-zA-Z]:/.test(normalized)) {
      return `非法条目路径: ${rel}`;
    }
    const { validateSkillId } =
      await import('@modules/skills/loaders/adapter/safeSkillId');
    for (const seg of normalized.split('/')) {
      if (!seg || seg === '.') continue;
      const err = validateSkillId(seg);
      if (err) return `非法条目路径: ${rel} (${err})`;
    }
    return null;
  }

  /**
   * frontmatter 字段值清洗（S0-4）：去除换行（防 --- 注入）并限制长度
   */
  private sanitizeSkillFrontmatterValue(value: string, maxLen: number): string {
    return value
      .replace(/[\r\n]+/g, ' ')
      .replace(/^---\s*/, '')
      .slice(0, maxLen)
      .trim();
  }

  /**
   * 处理获取系统技能内容 GET /v1/skills/system/:id/content
   * 读取 SKILL.md 文件返回原始内容及 frontmatter
   */
  private async handleSystemSkillContent(
    _req: http.IncomingMessage,
    res: http.ServerResponse,
    skillId: string
  ): Promise<void> {
    try {
      const { validateSkillId } =
        await import('@modules/skills/loaders/adapter/safeSkillId');
      const decodedId = decodeURIComponent(skillId);
      const idError = validateSkillId(decodedId);
      if (idError) {
        res.writeHead(400, {
          'Content-Type': 'application/json; charset=utf-8',
        });
        res.end(
          JSON.stringify({
            error: { code: 'INVALID_PARAM', message: idError },
          })
        );
        return;
      }

      const { readFile } = await import('fs/promises');
      const { existsSync } = await import('fs');
      const { resolveProjectRoot, resolvePyappHome } =
        await import('@modules/core/paths');
      const pathMod = await import('path');

      const candidateDirs = [
        pathMod.join(
          resolveProjectRoot(),
          'app',
          'src',
          'builtin',
          'skills',
          decodedId
        ),
        pathMod.join(resolvePyappHome(), 'skills', decodedId),
      ];

      let skillFile = '';
      for (const dir of candidateDirs) {
        const candidate = pathMod.join(dir, 'SKILL.md');
        if (existsSync(candidate)) {
          skillFile = candidate;
          break;
        }
      }

      if (!skillFile) {
        // 2026-08-06：内置技能为程序化定义（BundledSkillLoader），无 SKILL.md 文件；
        // 回退读取 registry 中 BUILTIN 源技能的 prompt 内容
        try {
          const { skillRegistry: builtinRegistry } =
            await import('@modules/constants/systemPromptSections');
          const bundled = builtinRegistry.get(decodedId);
          if (bundled?.impl?.kind === 'prompt') {
            const prompts = await bundled.impl.getPromptForCommand('', {});
            const content = prompts.map((p) => p.text).join('\n');
            res.writeHead(200, {
              'Content-Type': 'application/json; charset=utf-8',
            });
            res.end(
              JSON.stringify({
                content,
                rawContent: content,
                frontmatter: {
                  name: bundled.name,
                  description: bundled.description,
                  version: bundled.version || '1.0.0',
                },
                linkedFiles: [],
              })
            );
            return;
          }
        } catch (_err) {
          // @ignore-catch: 内置技能回退失败则正常 404
        }
        res.writeHead(404, {
          'Content-Type': 'application/json; charset=utf-8',
        });
        res.end(JSON.stringify({ error: { message: '技能未找到' } }));
        return;
      }

      const rawContent = await readFile(skillFile, 'utf-8');
      let content = rawContent;
      const frontmatter: Record<string, unknown> = {};
      const linkedFiles: string[] = [];

      const fmMatch = rawContent.match(/^---\n([\s\S]*?)\n---\n/);
      if (fmMatch) {
        content = rawContent.slice(fmMatch[0].length);
        const lines = fmMatch[1].split('\n');
        for (const line of lines) {
          const m = line.match(/^(\w[\w-]*):\s*(.+)$/);
          if (m) frontmatter[m[1]] = m[2].trim();
        }
      }

      // 收集关联文件
      const skillDir = pathMod.dirname(skillFile);
      try {
        const entries = await (
          await import('fs/promises')
        ).readdir(skillDir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isFile() && entry.name !== 'SKILL.md') {
            linkedFiles.push(entry.name);
          }
        }
      } catch (_err) {
        /* ignore */
      }

      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(
        JSON.stringify({
          content,
          rawContent,
          frontmatter,
          linkedFiles,
        })
      );
    } catch (err) {
      this.sendError(res, err);
    }
  }

  /**
   * 处理技能导出 GET /v1/skills/export（v1.5 阶段 2，修复 P1-1）
   * 打包用户技能目录为 ZIP：skills/<id>/skill.json + SKILL.md + 其余文件
   */
  private async handleExportSkills(
    _req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      const { resolvePyappHome } = await import('@modules/core/paths');
      const { default: AdmZipClass } = await import('adm-zip');

      const userSkillsDir = path.join(resolvePyappHome(), 'skills');
      const zip = new AdmZipClass();

      if (fs.existsSync(userSkillsDir)) {
        const entries = fs.readdirSync(userSkillsDir, { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isDirectory()) continue;
          if (
            entry.name.startsWith('.') ||
            entry.name.endsWith('.tmp') ||
            entry.name.endsWith('.bak')
          ) {
            continue; // 跳过隐藏/过渡目录（v1.5：导出不含 .tmp/.bak）
          }
          const skillDir = path.join(userSkillsDir, entry.name);
          const zipPrefix = `skills/${entry.name}`;
          // skill.json（元数据，从 SKILL.md frontmatter 提取）
          const skillMd = path.join(skillDir, 'SKILL.md');
          if (fs.existsSync(skillMd)) {
            const raw = fs.readFileSync(skillMd, 'utf-8');
            const fm = raw.match(/^---\n([\s\S]*?)\n---\n/);
            const meta: Record<string, unknown> = {};
            if (fm) {
              for (const line of fm[1].split('\n')) {
                const m = line.match(/^(\w[\w-]*):\s*(.+)$/);
                if (m) meta[m[1]] = m[2].trim();
              }
            }
            zip.addFile(
              `${zipPrefix}/skill.json`,
              Buffer.from(
                JSON.stringify(
                  { id: entry.name, ...meta, manifestVersion: '1.0' },
                  null,
                  2
                ),
                'utf-8'
              )
            );
          }
          zip.addLocalFolder(skillDir, zipPrefix);
        }
      }

      const buffer = zip.toBuffer();
      res.writeHead(200, {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="skills-export-${Date.now()}.zip"`,
      });
      res.end(buffer);
    } catch (err) {
      this.sendError(res, err);
    }
  }

  /**
   * 处理技能导入 POST /v1/skills/import（v1.5 阶段 2，修复 P1-2）
   * 支持两种格式：
   * - { zipBase64 }：ZIP 二进制 base64（由前端导出 ZIP 导入）
   * - { skillId, files: Record<string,string> }：JSON 文件清单（含 SKILL.md）
   * 落盘到 <pyappHome>/skills/<id>/；含权限的审批流在阶段 5 接入
   */
  private async handleImportSkill(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      const { resolvePyappHome } = await import('@modules/core/paths');
      const body = JSON.parse((await this.readRequestBody(req)) || '{}');

      const userSkillsDir = path.join(resolvePyappHome(), 'skills');
      let skillId = '';
      let files: Record<string, string> = {};

      if (typeof body.zipBase64 === 'string') {
        const { default: AdmZipClass } = await import('adm-zip');
        const zip = new AdmZipClass(Buffer.from(body.zipBase64, 'base64'));
        for (const entry of zip.getEntries()) {
          if (entry.isDirectory) continue;
          const parts = entry.entryName
            .replace(/\\/g, '/')
            .split('/')
            .filter(Boolean);
          // 顶层目录名作为技能 id（skills/<id>/... 或 <id>/...）
          const first = parts[0];
          if (!skillId) skillId = first === 'skills' ? parts[1] || '' : first;
          const rel = (
            first === 'skills' ? parts.slice(2) : parts.slice(1)
          ).join('/');
          if (!rel) continue;
          // zip-slip 防护（S0-2 强化）：规范化路径必须落在技能目录内
          const relErr = await this.skillRelError(rel);
          if (relErr) {
            res.writeHead(400, {
              'Content-Type': 'application/json; charset=utf-8',
            });
            res.end(
              JSON.stringify({
                error: {
                  code: 'SKILL_IMPORT_REJECTED',
                  message: `${relErr}（来源: ${entry.entryName}）`,
                },
              })
            );
            return;
          }
          files[rel] = entry.getData().toString('utf-8');
        }
      } else if (body.skillId && body.files && typeof body.files === 'object') {
        skillId = String(body.skillId);
        files = body.files;
        // S0-2：JSON files 分支 rel 校验（此前遗漏，可写出任意路径）
        for (const rel of Object.keys(files)) {
          const relErr = await this.skillRelError(rel);
          if (relErr) {
            res.writeHead(400, {
              'Content-Type': 'application/json; charset=utf-8',
            });
            res.end(
              JSON.stringify({
                error: { code: 'SKILL_IMPORT_REJECTED', message: relErr },
              })
            );
            return;
          }
        }
      } else if (Array.isArray(body.skills)) {
        // S2-1 双兼容：{ skills: [{ name, description, category }] } 简易导入
        const { sanitizeSkillId } =
          await import('@modules/skills/loaders/adapter/safeSkillId');
        const imported: string[] = [];
        for (const item of body.skills) {
          if (!item || typeof item.name !== 'string' || !item.name.trim()) {
            continue;
          }
          const name = item.name.trim();
          const safeName = sanitizeSkillId(name) || 'unnamed-skill';
          const skillDir = path.join(userSkillsDir, safeName);
          fs.mkdirSync(skillDir, { recursive: true });
          const frontmatter = [
            '---',
            `name: ${this.sanitizeSkillFrontmatterValue(name, 200)}`,
            `description: ${this.sanitizeSkillFrontmatterValue(
              String(item.description ?? ''),
              1000
            )}`,
            `category: ${this.sanitizeSkillFrontmatterValue(
              String(item.category ?? 'general'),
              100
            )}`,
            'version: 1.0.0',
            '---',
            '',
          ].join('\n');
          fs.writeFileSync(
            path.join(skillDir, 'SKILL.md'),
            frontmatter,
            'utf-8'
          );
          imported.push(safeName);
        }
        res.writeHead(200, {
          'Content-Type': 'application/json; charset=utf-8',
        });
        res.end(JSON.stringify({ success: true, imported }));
        // 写盘后重载 registry，使新技能立即可被 SkillTool/注入感知（不阻塞响应）
        void this.reloadUserSkillsAfterWrite();
        return;
      }

      if (!skillId || Object.keys(files).length === 0) {
        res.writeHead(400, {
          'Content-Type': 'application/json; charset=utf-8',
        });
        res.end(
          JSON.stringify({
            error: {
              code: 'INVALID_PARAM',
              message: '需要 zipBase64 或 skillId+files',
            },
          })
        );
        return;
      }

      // 基础 id 校验（v1.5 阶段 4：safeSkillId 白名单）
      const { validateSkillId } =
        await import('@modules/skills/loaders/adapter/safeSkillId');
      const idError = validateSkillId(skillId);
      if (idError) {
        res.writeHead(400, {
          'Content-Type': 'application/json; charset=utf-8',
        });
        res.end(
          JSON.stringify({
            error: { code: 'INVALID_PARAM', message: idError },
          })
        );
        return;
      }

      const target = path.join(userSkillsDir, skillId);
      fs.mkdirSync(target, { recursive: true });
      for (const [rel, content] of Object.entries(files)) {
        const dest = path.join(target, rel);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, content, 'utf-8');
      }

      // 导入权限审批（v1.5 阶段 4，P3-13）：解析 SKILL.md permissions，
      // 含敏感权限（file-write/command/host-access）→ 先落盘"未启用"，待用户确认
      let requiresApproval = false;
      const skillMdPath = path.join(target, 'SKILL.md');
      if (fs.existsSync(skillMdPath)) {
        const { parseSkillPermissions, hasSensitivePermission } =
          await import('@modules/skills/loaders/adapter/SkillPermission');
        const permissions = parseSkillPermissions(
          fs.readFileSync(skillMdPath, 'utf-8')
        );
        if (hasSensitivePermission(permissions)) {
          fs.writeFileSync(path.join(target, '.enabled'), 'false', 'utf-8');
          requiresApproval = true;
        }
      }

      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: true, skillId, requiresApproval }));
      // 写盘后重载 registry，使新技能立即可被 SkillTool/注入感知（不阻塞响应）
      void this.reloadUserSkillsAfterWrite();
    } catch (err) {
      this.sendError(res, err);
    }
  }

  /**
   * 处理技能克隆 POST /v1/skills/:id/clone（v1.5 阶段 2，修复 P1-3）
   * 复制技能目录为 <原名>-copy（冲突递增），保持与本地新建相同的落盘结构
   */
  private async handleCloneSkill(
    _req: http.IncomingMessage,
    res: http.ServerResponse,
    skillId: string
  ): Promise<void> {
    try {
      const decoded = await this.validateSkillIdParam(skillId, res);
      if (decoded === null) return;

      const { resolvePyappHome } = await import('@modules/core/paths');
      const userSkillsDir = path.join(resolvePyappHome(), 'skills');
      const src = path.join(userSkillsDir, decoded);

      if (!fs.existsSync(src)) {
        res.writeHead(404, {
          'Content-Type': 'application/json; charset=utf-8',
        });
        res.end(
          JSON.stringify({
            error: { code: 'SKILL_NOT_FOUND', message: '技能未找到' },
          })
        );
        return;
      }

      let newId = `${skillId}-copy`;
      let counter = 2;
      while (fs.existsSync(path.join(userSkillsDir, newId))) {
        newId = `${skillId}-copy${counter}`;
        counter++;
      }

      fs.cpSync(src, path.join(userSkillsDir, newId), { recursive: true });

      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: true, skillId: newId }));
    } catch (err) {
      this.sendError(res, err);
    }
  }

  /**
   * 处理技能文件列表 GET /v1/skills/:id/files（v1.5 阶段 2，修复 P1-4）
   * 返回技能目录内所有文件（相对路径 + 大小）
   */
  private async handleSkillFiles(
    _req: http.IncomingMessage,
    res: http.ServerResponse,
    skillId: string
  ): Promise<void> {
    try {
      const decoded = await this.validateSkillIdParam(skillId, res);
      if (decoded === null) return;

      const { resolvePyappHome } = await import('@modules/core/paths');
      const userSkillsDir = path.join(resolvePyappHome(), 'skills');
      const skillDir = path.join(userSkillsDir, decoded);

      if (!fs.existsSync(skillDir)) {
        res.writeHead(404, {
          'Content-Type': 'application/json; charset=utf-8',
        });
        res.end(
          JSON.stringify({
            error: { code: 'SKILL_NOT_FOUND', message: '技能未找到' },
          })
        );
        return;
      }

      const files: Array<{ name: string; size: number }> = [];
      const walk = (dir: string, prefix: string): void => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, entry.name);
          const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
          if (entry.isDirectory()) {
            walk(full, rel);
          } else {
            files.push({ name: rel, size: fs.statSync(full).size });
          }
        }
      };
      walk(skillDir, '');

      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ files }));
    } catch (err) {
      this.sendError(res, err);
    }
  }

  /**
   * 处理系统技能关联文件内容 GET /v1/skills/system/:id/files/content?path=（v1.5 阶段 2，修复 P1-5）
   * 带基础路径穿越拦截（../、绝对路径），阶段 4 强化为 safeSkillId
   */
  private async handleSystemSkillFileContent(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    skillId: string
  ): Promise<void> {
    try {
      // S0-1：skillId 与 filePath 双重校验
      const decodedId = await this.validateSkillIdParam(skillId, res);
      if (decodedId === null) return;

      const urlObj = new URL(req.url!, `http://${req.headers.host}`);
      const filePath = urlObj.searchParams.get('path') || '';

      const pathErr = await this.skillRelError(filePath);
      if (pathErr) {
        res.writeHead(400, {
          'Content-Type': 'application/json; charset=utf-8',
        });
        res.end(
          JSON.stringify({
            error: { code: 'INVALID_PARAM', message: pathErr },
          })
        );
        return;
      }

      const { resolveProjectRoot, resolvePyappHome } =
        await import('@modules/core/paths');
      const candidateDirs = [
        path.join(
          resolveProjectRoot(),
          'app',
          'src',
          'builtin',
          'skills',
          decodedId
        ),
        path.join(resolvePyappHome(), 'skills', decodedId),
      ];

      let target = '';
      for (const dir of candidateDirs) {
        const candidate = path.join(dir, filePath);
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
          target = candidate;
          break;
        }
      }

      if (!target) {
        res.writeHead(404, {
          'Content-Type': 'application/json; charset=utf-8',
        });
        res.end(
          JSON.stringify({
            error: { code: 'SKILL_NOT_FOUND', message: '文件未找到' },
          })
        );
        return;
      }

      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ content: fs.readFileSync(target, 'utf-8') }));
    } catch (err) {
      this.sendError(res, err);
    }
  }

  /**
   * 处理搜索技能请求 GET /v1/skills/search?q=...&category=...&tags=...&source=...
   * source: 限定搜索源（clawhub / github），不传则搜索全部
   */
  private async handleSearchSkills(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      const urlObj = new URL(req.url!, `http://${req.headers.host}`);
      const query = urlObj.searchParams.get('q') || '';
      const category = urlObj.searchParams.get('category') || undefined;
      const tagsStr = urlObj.searchParams.get('tags') || undefined;
      const tags = tagsStr
        ? tagsStr.split(',').map((t) => t.trim())
        : undefined;
      const source = urlObj.searchParams.get('source') || undefined;

      const adapter = await this.getClawHubAdapter();
      const results = await adapter.searchSkills(query, {
        category,
        tags,
        source,
      });

      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ results }));
    } catch (err) {
      this.sendError(res, err);
    }
  }

  /**
   * 处理推荐技能列表请求 GET /v1/skills/recommended
   * 返回 ClawHub 市场推荐的技能列表
   */
  private async handleRecommendedSkills(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      const urlObj = new URL(req.url!, `http://${req.headers.host}`);
      const limit = parseInt(urlObj.searchParams.get('limit') || '10', 10);

      const adapter = await this.getClawHubAdapter();
      const installed = await adapter.getInstalledSkills();
      const installedIds = new Set(
        installed.map((s: unknown) => (s as { meta: { id: string } }).meta.id)
      );

      const searchEngine = adapter.getSearchEngine();
      const allResults = await searchEngine.searchRemote('', {});

      const recommended = allResults
        .filter(
          (r: unknown) =>
            !installedIds.has((r as { skill: { id: string } }).skill.id)
        )
        .slice(0, limit)
        .map((r: unknown) => ({
          ...(r as Record<string, unknown>),
          installed: false,
        }));

      const categories = this.getSkillCategoryMap(installed);

      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ recommended, categories }));
    } catch (err) {
      this.sendError(res, err);
    }
  }

  /**
   * 处理技能分类列表请求 GET /v1/skills/categories
   * 按能力分类统计已安装插件数量，技能统一归入 skill 分类
   */
  private async handleSkillCategories(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      const { PLUGIN_CATEGORIES } =
        await import('@modules/plugins/categories/PluginCategories');

      const adapter = await this.getClawHubAdapter();
      const installed = await adapter.getInstalledSkills();

      const categoryMap = this.getSkillCategoryMap(installed);

      const categories = Object.entries(PLUGIN_CATEGORIES).map(
        ([key, cat]) => ({
          id: key,
          capability: cat.capability,
          description: cat.description,
          count: categoryMap[key] || 0,
        })
      );

      const sourceMap = this.getSkillSourceMap(installed);

      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ categories, sourceDistribution: sourceMap }));
    } catch (err) {
      this.sendError(res, err);
    }
  }

  /**
   * 处理技能来源列表请求 GET /v1/skills/sources
   * 返回 SearchEngine 中注册的所有搜索源名称
   */
  private async handleSkillSources(
    _req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      const adapter = await this.getClawHubAdapter();
      const searchEngine = adapter.getSearchEngine();
      const sources = searchEngine.getSourceNames() as string[];

      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ sources }));
    } catch (err) {
      this.sendError(res, err);
    }
  }

  /**
   * 添加自定义技能搜索源 POST /v1/skills/sources
   * Body: { name: string, apiBaseUrl: string }
   */
  private async handleAddSkillSource(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      const body = await this.readRequestBody(req);
      const { name, apiBaseUrl } = JSON.parse(body || '{}');

      if (
        !name ||
        !apiBaseUrl ||
        typeof name !== 'string' ||
        typeof apiBaseUrl !== 'string'
      ) {
        res.writeHead(400, {
          'Content-Type': 'application/json; charset=utf-8',
        });
        res.end(
          JSON.stringify({ error: { message: '需要 name 和 apiBaseUrl 字段' } })
        );
        return;
      }

      const adapter = await this.getClawHubAdapter();
      const searchEngine = adapter.getSearchEngine();
      searchEngine.addCustomSource(name.trim(), apiBaseUrl.trim());

      const sources = searchEngine.getSourceNames() as string[];
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: true, sources }));
    } catch (err) {
      this.sendError(res, err);
    }
  }

  /**
   * 移除自定义技能搜索源 DELETE /v1/skills/sources/:name
   */
  private async handleRemoveSkillSource(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    name: string
  ): Promise<void> {
    try {
      const adapter = await this.getClawHubAdapter();
      const searchEngine = adapter.getSearchEngine();
      searchEngine.removeCustomSource(decodeURIComponent(name));

      const sources = searchEngine.getSourceNames() as string[];
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: true, sources }));
    } catch (err) {
      this.sendError(res, err);
    }
  }

  /**
   * 构建插件分类统计映射
   * 所有技能统一归入 skill 分类，不再按来源分裂
   */
  private getSkillCategoryMap(installed: unknown[]): Record<string, number> {
    const map: Record<string, number> = {};

    for (const skill of installed) {
      const s = skill as { meta: { source?: string } };
      const source = s.meta.source || 'third_party';

      if (source === 'builtin') {
        map['builtin'] = (map['builtin'] || 0) + 1;
      } else {
        map['skill'] = (map['skill'] || 0) + 1;
      }
    }

    return map;
  }

  /**
   * 构建技能来源分布统计
   * 按 source 字段统计各来源的技能数量
   */
  private getSkillSourceMap(installed: unknown[]): Record<string, number> {
    const map: Record<string, number> = {};

    for (const skill of installed) {
      const s = skill as { meta: { source?: string } };
      const source = s.meta.source || 'unknown';
      map[source] = (map[source] || 0) + 1;
    }

    return map;
  }

  /**
   * 处理获取技能详情请求 GET /v1/skills/:id
   */
  private async handleGetSkillDetail(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    skillId: string
  ): Promise<void> {
    try {
      const adapter = await this.getClawHubAdapter();
      const skill = await adapter.getSkillDetail(skillId);

      if (!skill) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({ error: { message: `技能未找到: ${skillId}` } })
        );
        return;
      }

      // P3-23: 附带远端最新版本（repo/market 双形态；失败静默降级为 null）
      let remoteVersion: string | null = null;
      try {
        remoteVersion = await adapter.getRemoteVersion(skillId);
      } catch {
        // 远端不可达时前端降级为"未知"，不显示"有更新"
      }

      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ skill, remoteVersion }));
    } catch (err) {
      this.sendError(res, err);
    }
  }

  /**
   * 处理安装技能请求 POST /v1/skills/install
   */
  private async handleInstallSkill(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      const body = await this.readRequestBody(req);
      if (!body) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({ error: { message: 'request body is required' } })
        );
        return;
      }

      const parsedBody = JSON.parse(body);
      const { skillId, sourceUrl } = parsedBody;

      if (!skillId) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'skillId is required' } }));
        return;
      }

      const adapter = await this.getClawHubAdapter();
      const installed = await adapter.installSkill(skillId, sourceUrl);

      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: true, skill: installed }));
    } catch (err) {
      this.sendError(res, err);
    }
  }

  /**
   * 处理卸载技能请求 POST /v1/skills/:id/uninstall
   */
  private async handleUninstallSkill(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    skillId: string
  ): Promise<void> {
    try {
      const adapter = await this.getClawHubAdapter();
      await adapter.uninstallSkill(skillId);

      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: true }));
    } catch (err) {
      this.sendError(res, err);
    }
  }

  /**
   * 处理更新技能请求 POST /v1/skills/:id/update
   */
  private async handleUpdateSkill(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    skillId: string
  ): Promise<void> {
    try {
      const adapter = await this.getClawHubAdapter();
      const updated = await adapter.updateSkill(skillId);

      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: true, skill: updated }));
    } catch (err) {
      this.sendError(res, err);
    }
  }

  /**
   * 处理切换技能启用状态请求 POST /v1/skills/:id/toggle
   */
  private async handleToggleSkill(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    skillId: string
  ): Promise<void> {
    try {
      const body = await this.readRequestBody(req);
      const parsedBody = body ? JSON.parse(body) : {};
      const enabled = parsedBody.enabled;

      const adapter = await this.getClawHubAdapter();

      if (enabled === true) {
        await adapter.enableSkill(skillId);
        await this.applyLocalSkillEnabled(skillId, true);
      } else if (enabled === false) {
        await adapter.disableSkill(skillId);
        await this.applyLocalSkillEnabled(skillId, false);
      } else {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            error: { message: 'enabled field is required (true/false)' },
          })
        );
        return;
      }

      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: true, enabled }));
    } catch (err) {
      this.sendError(res, err);
    }
  }

  // ========== Agent Handlers ==========

  private async handleCancelAgentTask(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    taskId: string
  ): Promise<void> {
    try {
      const { coordinator } = await import('@modules/core/Coordinator');
      const success = coordinator.stopTask(taskId);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success, taskId }));
      this.broadcastEvent('agent:task-cancelled', { taskId });
    } catch (err) {
      this.sendError(res, err);
    }
  }

  private async handleGetAgentTaskState(
    _req: http.IncomingMessage,
    res: http.ServerResponse,
    taskId: string
  ): Promise<void> {
    try {
      const { SqliteTaskStore } =
        await import('@modules/tasks/db/SqliteTaskStore');
      const store = new SqliteTaskStore();
      await store.init();
      const state = await store.getTaskState(taskId);
      if (!state) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Task not found' }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(state));
    } catch (err) {
      this.sendError(res, err);
    }
  }

  private async handleGetAgentTaskAudit(
    _req: http.IncomingMessage,
    res: http.ServerResponse,
    taskId: string
  ): Promise<void> {
    try {
      const { SqliteTaskStore } =
        await import('@modules/tasks/db/SqliteTaskStore');
      const store = new SqliteTaskStore();
      await store.init();
      const logs = await store.queryAuditLogs(taskId);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(logs));
    } catch (err) {
      this.sendError(res, err);
    }
  }

  private async handleGetAgentTaskLogs(
    _req: http.IncomingMessage,
    res: http.ServerResponse,
    taskId: string
  ): Promise<void> {
    try {
      const logs: string[] = [];

      // 从 SQLite 加载日志
      try {
        const { SqliteTaskStore } =
          await import('@modules/tasks/db/SqliteTaskStore');
        const store = new SqliteTaskStore();
        await store.init();
        const state = await store.getTaskState(taskId);
        if (state) {
          logs.push(
            `Task: ${state.description || taskId} | Status: ${state.status} | Type: ${state.type}`
          );
          if (state.outputFile) {
            const fs = await import('fs');
            if (fs.existsSync(state.outputFile)) {
              const content = fs.readFileSync(state.outputFile, 'utf-8');
              logs.push(...content.split('\n').filter(Boolean).slice(-100));
            }
          }
          if (state.error) {
            logs.push(`Error: ${state.error}`);
          }
        } else {
          logs.push(`Task ${taskId} not found in store`);
        }
      } catch (e) {
        logs.push(`Failed to load task state: ${String(e)}`);
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(logs));
    } catch (err) {
      this.sendError(res, err);
    }
  }

  private async handleGetAgentTaskOutput(
    _req: http.IncomingMessage,
    res: http.ServerResponse,
    taskId: string
  ): Promise<void> {
    try {
      const fs = await import('fs');
      const { SqliteTaskStore } =
        await import('@modules/tasks/db/SqliteTaskStore');
      const store = new SqliteTaskStore();
      await store.init();
      const state = await store.getTaskState(taskId);

      let output = '';
      if (state?.outputFile && fs.existsSync(state.outputFile)) {
        output = fs.readFileSync(state.outputFile, 'utf-8');
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(output));
    } catch (err) {
      this.sendError(res, err);
    }
  }

  private async handleRecoverAgentTask(
    _req: http.IncomingMessage,
    res: http.ServerResponse,
    taskId: string
  ): Promise<void> {
    try {
      const { taskRegistry } = await import('@modules/tasks');
      const recovered = await taskRegistry.recoverLostTask(taskId);
      if (!recovered) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({ error: 'Task not found or not in LOST state' })
        );
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, taskId }));
      this.broadcastEvent('agent:task-recovered', { taskId });
    } catch (err) {
      this.sendError(res, err);
    }
  }

  private async handleAgentTaskChat(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    taskId: string
  ): Promise<void> {
    try {
      const body = await this.readRequestBody(req);
      const { message } = JSON.parse(body);
      let reply = '';
      try {
        const coreAPI = getCoreAPI();
        reply =
          (await (
            coreAPI as unknown as {
              sendTaskMessage?: (
                taskId: string,
                msg: string
              ) => Promise<string>;
            }
          ).sendTaskMessage?.(taskId, message)) || '';
      } catch (_err) {
        // 降级：通过 executor 直接执行
        const { coordinator } = await import('@modules/core/Coordinator');
        const task = (
          coordinator as unknown as { getTask(id: string): unknown }
        ).getTask(taskId);
        if (
          task &&
          typeof (task as { sendMessage: unknown }).sendMessage === 'function'
        ) {
          reply = await (
            task as { sendMessage(msg: string): Promise<string> }
          ).sendMessage(message);
        }
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(reply || '(Agent未响应)'));
      this.broadcastEvent('agent:task-chat', { taskId });
    } catch (err) {
      this.sendError(res, err);
    }
  }

  // ========== PDCA Handlers ==========

  private async handlePdcaStart(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      const body = await this.readRequestBody(req);
      const { description, sessionId } = JSON.parse(body);
      const taskId = `pdca_${Date.now().toString(36)}`;

      const { getOrCreateOrchestrator } =
        await import('@modules/tasks/LongRunningTaskOrchestrator');
      const orchestrator = getOrCreateOrchestrator(taskId);
      const status = await orchestrator.runFullPdca(
        description,
        sessionId || ''
      );

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(status));
      this.broadcastEvent('pdca:started', { taskId, status });
    } catch (err) {
      this.sendError(res, err);
    }
  }

  private async handlePdcaStatus(
    _req: http.IncomingMessage,
    res: http.ServerResponse,
    taskId: string
  ): Promise<void> {
    try {
      let orchestrator: PdcaOrchestratorLike | null = null;
      try {
        const mod = await import('@modules/tasks/LongRunningTaskOrchestrator');
        orchestrator = (mod.getOrchestrator(taskId) ??
          null) as PdcaOrchestratorLike | null;
      } catch (_err) {
        // 模块加载失败或无 orchestrator
      }
      if (!orchestrator) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({ taskId, phase: 'none', planId: '', lifecycle: [] })
        );
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(orchestrator.getStatus()));
    } catch (err) {
      this.sendError(res, err);
    }
  }

  private async handlePdcaAudit(
    _req: http.IncomingMessage,
    res: http.ServerResponse,
    taskId: string
  ): Promise<void> {
    try {
      let orchestrator: PdcaOrchestratorLike | null = null;
      try {
        const m = await import('@modules/tasks/LongRunningTaskOrchestrator');
        orchestrator = (m.getOrchestrator(taskId) ??
          null) as PdcaOrchestratorLike | null;
      } catch (err) {
        handleError(err, {
          module: 'infrastructure:http:LocalHTTPService',
          action: 'orchestratorImportFailed',
        });
      } /* 可选模块, 加载失败时降级 */
      if (!orchestrator) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ taskId, error: 'Not available' }));
        return;
      }
      const report = orchestrator.generateReport();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(report));
    } catch (err) {
      this.sendError(res, err);
    }
  }

  private async handlePdcaReviewStep(
    _req: http.IncomingMessage,
    res: http.ServerResponse,
    taskId: string,
    stepId: string
  ): Promise<void> {
    try {
      let orchestrator: PdcaOrchestratorLike | null = null;
      try {
        const m = await import('@modules/tasks/LongRunningTaskOrchestrator');
        orchestrator = (m.getOrchestrator(taskId) ??
          null) as PdcaOrchestratorLike | null;
      } catch (err) {
        handleError(err, {
          module: 'infrastructure:http:LocalHTTPService',
          action: 'orchestratorImportFailed',
        });
      } /* 可选模块, 加载失败时降级 */
      if (!orchestrator) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not available' }));
        return;
      }
      const review = await orchestrator.reviewStep(stepId);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(review));
      this.broadcastEvent('pdca:reviewed', { taskId, stepId, review });
    } catch (err) {
      this.sendError(res, err);
    }
  }

  private async handlePdcaDecideStep(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    taskId: string,
    stepId: string
  ): Promise<void> {
    try {
      const body = await this.readRequestBody(req);
      const { decision } = JSON.parse(body);
      let orchestrator: PdcaOrchestratorLike | null = null;
      try {
        const m = await import('@modules/tasks/LongRunningTaskOrchestrator');
        orchestrator = (m.getOrchestrator(taskId) ??
          null) as PdcaOrchestratorLike | null;
      } catch (err) {
        handleError(err, {
          module: 'infrastructure:http:LocalHTTPService',
          action: 'orchestratorImportFailed',
        });
      } /* 可选模块, 加载失败时降级 */
      if (!orchestrator) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not available' }));
        return;
      }
      await orchestrator.decideStep(stepId, decision);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      this.broadcastEvent('pdca:decided', { taskId, stepId, decision });
    } catch (err) {
      this.sendError(res, err);
    }
  }

  private async handlePdcaList(
    _req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      let list: unknown[] = [];
      try {
        const m = await import('@modules/tasks/LongRunningTaskOrchestrator');
        list = m
          .getAllOrchestrators()
          .map((o: PdcaOrchestratorLike) => o.getStatus());
      } catch (err) {
        handleError(err, {
          module: 'infrastructure:http:LocalHTTPService',
          action: 'orchestratorImportFailed',
        });
      } /* 可选模块, 加载失败时降级 */
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(list));
    } catch (err) {
      this.sendError(res, err);
    }
  }

  private async handlePdcaConfirm(
    _req: http.IncomingMessage,
    res: http.ServerResponse,
    taskId: string
  ): Promise<void> {
    try {
      let orchestrator: PdcaOrchestratorLike | null = null;
      try {
        const m = await import('@modules/tasks/LongRunningTaskOrchestrator');
        orchestrator = (m.getOrchestrator(taskId) ??
          null) as PdcaOrchestratorLike | null;
      } catch (err) {
        handleError(err, {
          module: 'infrastructure:http:LocalHTTPService',
          action: 'orchestratorImportFailed',
        });
      } /* 可选模块, 加载失败时降级 */
      if (!orchestrator) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(orchestrator.getStatus()));
    } catch (err) {
      this.sendError(res, err);
    }
  }

  // ========== Kanban Handlers ==========

  private async handleKanbanList(
    _req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      const { SqliteTaskStore } =
        await import('@modules/tasks/db/SqliteTaskStore');
      const store = new SqliteTaskStore();
      await store.init();
      const cards = await store.loadKanbanCards();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(cards));
    } catch (err) {
      this.sendError(res, err);
    }
  }

  private async handleKanbanCreate(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      const body = await this.readRequestBody(req);
      const { title, description, columnId, assignee, priority, tags } =
        JSON.parse(body);
      const { SqliteTaskStore } =
        await import('@modules/tasks/db/SqliteTaskStore');
      const store = new SqliteTaskStore();
      await store.init();
      const card = {
        id: `kb_${Date.now().toString(36)}`,
        title,
        description,
        columnId: columnId || 'todo',
        assignee,
        priority: priority || 'medium',
        tags: tags || [],
        sortOrder: Date.now(),
      };
      await store.saveKanbanCard(card);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(card));
      this.broadcastEvent('kanban:created', { card });
    } catch (err) {
      this.sendError(res, err);
    }
  }

  private async handleKanbanUpdate(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    cardId: string
  ): Promise<void> {
    try {
      const body = await this.readRequestBody(req);
      const { title, description, assignee, priority, tags } = JSON.parse(body);
      const { SqliteTaskStore } =
        await import('@modules/tasks/db/SqliteTaskStore');
      const store = new SqliteTaskStore();
      await store.init();
      await store.saveKanbanCard({
        id: cardId,
        title: title || '',
        description,
        assignee,
        priority,
        tags,
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      this.broadcastEvent('kanban:updated', { cardId });
    } catch (err) {
      this.sendError(res, err);
    }
  }

  private async handleKanbanDelete(
    _req: http.IncomingMessage,
    res: http.ServerResponse,
    cardId: string
  ): Promise<void> {
    try {
      const { SqliteTaskStore } =
        await import('@modules/tasks/db/SqliteTaskStore');
      const store = new SqliteTaskStore();
      await store.init();
      await store.deleteKanbanCard(cardId);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      this.broadcastEvent('kanban:deleted', { cardId });
    } catch (err) {
      this.sendError(res, err);
    }
  }

  private async handleKanbanMove(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    cardId: string
  ): Promise<void> {
    try {
      const body = await this.readRequestBody(req);
      const { columnId, sortOrder } = JSON.parse(body);
      const { SqliteTaskStore } =
        await import('@modules/tasks/db/SqliteTaskStore');
      const store = new SqliteTaskStore();
      await store.init();
      await store.updateKanbanCardColumn(
        cardId,
        columnId,
        sortOrder ?? Date.now()
      );
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      this.broadcastEvent('kanban:moved', { cardId, columnId });
    } catch (err) {
      this.sendError(res, err);
    }
  }

  // ========== Plan & Flow Handlers ==========

  private async handleListPlans(
    _req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      const { taskOrchestrator } =
        await import('@modules/tasks/TaskOrchestrator');
      await taskOrchestrator['initialize']();
      const plans = taskOrchestrator.getAllPlans();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(plans));
    } catch (err) {
      this.sendError(res, err);
    }
  }

  private async handleCreatePlan(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      const { taskOrchestrator } =
        await import('@modules/tasks/TaskOrchestrator');
      const body = await this.readRequestBody(req);
      const { description, steps, sessionId } = JSON.parse(body);
      const plan = taskOrchestrator.createPlan(
        description || '',
        steps || [],
        sessionId || ''
      );
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(plan));
      this.broadcastEvent('plan:created', { planId: plan.id });
    } catch (err) {
      this.sendError(res, err);
    }
  }

  private async handleGetPlan(
    _req: http.IncomingMessage,
    res: http.ServerResponse,
    planId: string
  ): Promise<void> {
    try {
      const { taskOrchestrator } =
        await import('@modules/tasks/TaskOrchestrator');
      const plan = taskOrchestrator.getPlan(planId);
      if (!plan) {
        res.writeHead(404);
        res.end(JSON.stringify({ error: 'Plan not found' }));
        return;
      }
      const progress = taskOrchestrator.getPlanProgress(planId);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ plan, progress }));
    } catch (err) {
      this.sendError(res, err);
    }
  }

  private async handleExecutePlan(
    _req: http.IncomingMessage,
    res: http.ServerResponse,
    planId: string
  ): Promise<void> {
    try {
      const { taskOrchestrator } =
        await import('@modules/tasks/TaskOrchestrator');
      const plan = taskOrchestrator.getPlan(planId);
      if (!plan) {
        res.writeHead(404);
        res.end(JSON.stringify({ error: 'Plan not found' }));
        return;
      }
      // 标记所有 pending 步骤为 running
      for (const step of plan.steps) {
        if (step.status === 'pending') {
          taskOrchestrator.markStepRunning(step.id);
        }
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, planId }));
      this.broadcastEvent('plan:executed', { planId });
    } catch (err) {
      this.sendError(res, err);
    }
  }

  private async handleAbortPlan(
    _req: http.IncomingMessage,
    res: http.ServerResponse,
    planId: string
  ): Promise<void> {
    try {
      const { taskOrchestrator } =
        await import('@modules/tasks/TaskOrchestrator');
      const plan = taskOrchestrator.getPlan(planId);
      if (!plan) {
        res.writeHead(404);
        res.end(JSON.stringify({ error: 'Plan not found' }));
        return;
      }
      // 标记所有 running/pending 步骤为 cancelled
      for (const step of plan.steps) {
        if (step.status === 'running' || step.status === 'pending') {
          taskOrchestrator.markStepFailed(step.id, '已终止');
        }
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, planId }));
      this.broadcastEvent('plan:aborted', { planId });
    } catch (err) {
      this.sendError(res, err);
    }
  }

  private async handleListFlows(
    _req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      const { taskFlowRegistry } =
        await import('@modules/tasks/TaskFlowRegistry');
      const flows = taskFlowRegistry.getAllFlows();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(flows));
    } catch (err) {
      this.sendError(res, err);
    }
  }

  private async handleGetFlow(
    _req: http.IncomingMessage,
    res: http.ServerResponse,
    flowId: string
  ): Promise<void> {
    try {
      const { taskFlowRegistry } =
        await import('@modules/tasks/TaskFlowRegistry');
      const flow = taskFlowRegistry.getFlow(flowId);
      if (!flow) {
        res.writeHead(404);
        res.end(JSON.stringify({ error: 'Flow not found' }));
        return;
      }
      const stats = taskFlowRegistry.getStats();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ flow, stats }));
    } catch (err) {
      this.sendError(res, err);
    }
  }

  // ========== Skill CRUD Handlers ==========

  /**
   * 处理创建技能 POST /v1/skills（v1.5 阶段 3：显式 action 字段，修复 P0-3 协议错配）
   * - { action: 'install', skillId, sourceUrl }：市场安装
   * - { action: 'create', name, description, category }：本地新建
   */
  private async handleCreateSkill(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      const body = JSON.parse((await this.readRequestBody(req)) || '{}');
      const { action } = body;

      if (action === 'install') {
        const { skillId, sourceUrl } = body;
        if (!skillId) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              error: { code: 'INVALID_PARAM', message: 'install 需要 skillId' },
            })
          );
          return;
        }
        const adapter = await this.getClawHubAdapter();
        const skill = await adapter.installSkill(skillId, sourceUrl);
        if (!skill) {
          // 3.6 安装结果如实反馈：失败/已存在 → 409
          res.writeHead(409, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              error: {
                code: 'SKILL_ALREADY_INSTALLED',
                message: `技能安装失败或已存在: ${skillId}`,
              },
            })
          );
          return;
        }
        res.writeHead(200, {
          'Content-Type': 'application/json; charset=utf-8',
        });
        res.end(JSON.stringify(skill));
        this.broadcastEvent('skill:created', { skill });
        return;
      }

      if (action === 'create') {
        const { name, description, category } = body;
        if (!name || typeof name !== 'string') {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              error: { code: 'INVALID_PARAM', message: 'create 需要 name' },
            })
          );
          return;
        }
        const skill = await this.createLocalSkill(
          name,
          description || '',
          category || 'general'
        );
        res.writeHead(200, {
          'Content-Type': 'application/json; charset=utf-8',
        });
        res.end(JSON.stringify(skill));
        this.broadcastEvent('skill:created', { skill });
        return;
      }

      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: {
            code: 'INVALID_PARAM',
            message: 'action 必填，取值 install|create',
          },
        })
      );
    } catch (err) {
      this.sendError(res, err);
    }
  }

  /**
   * 创建本地技能（写 SKILL.md 到 <pyappHome>/skills/<name>/）
   */
  private async createLocalSkill(
    name: string,
    description: string,
    category: string
  ): Promise<Record<string, unknown>> {
    const { resolvePyappHome } = await import('@modules/core/paths');
    const userSkillsDir = path.join(resolvePyappHome(), 'skills');
    // 目录名清洗（v1.5 阶段 4：safeSkillId）
    const { sanitizeSkillId } =
      await import('@modules/skills/loaders/adapter/safeSkillId');
    const safeName = sanitizeSkillId(name) || 'unnamed-skill';
    // S0-4：frontmatter 注入防护 —— 拦截 \n / --- 注入，限制长度
    const cleanName = this.sanitizeSkillFrontmatterValue(name, 200) || safeName;
    const cleanDescription = this.sanitizeSkillFrontmatterValue(
      description,
      1000
    );
    const cleanCategory = this.sanitizeSkillFrontmatterValue(
      category || 'general',
      100
    );
    const skillDir = path.join(userSkillsDir, safeName);

    fs.mkdirSync(skillDir, { recursive: true });
    const frontmatter = [
      '---',
      `name: ${cleanName}`,
      `description: ${cleanDescription}`,
      `category: ${cleanCategory}`,
      'version: 1.0.0',
      '---',
      '',
    ].join('\n');
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), frontmatter, 'utf-8');

    return {
      id: safeName,
      name: cleanName,
      description: cleanDescription,
      status: 'enabled',
      category: cleanCategory,
      version: '1.0.0',
      source: 'user',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
  }

  private async handleUpdateSkillById(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    skillId: string
  ): Promise<void> {
    try {
      const decoded = await this.validateSkillIdParam(skillId, res);
      if (decoded === null) return;

      const body = JSON.parse((await this.readRequestBody(req)) || '{}');

      // S2-1 ④：PUT 携带本地技能内容更新字段 → 更新本地 SKILL.md（原实现丢弃 body）
      if (body && typeof body === 'object' && Object.keys(body).length > 0) {
        const { resolvePyappHome } = await import('@modules/core/paths');
        const skillMdPath = path.join(
          resolvePyappHome(),
          'skills',
          decoded,
          'SKILL.md'
        );
        if (fs.existsSync(skillMdPath)) {
          const updated = await this.updateLocalSkill(
            decoded,
            body as Record<string, unknown>,
            skillMdPath
          );
          res.writeHead(200, {
            'Content-Type': 'application/json; charset=utf-8',
          });
          res.end(JSON.stringify({ success: true, skill: updated }));
          this.broadcastEvent('skill:updated', { skill: updated });
          // 内容更新后重载 registry（新技能/改名场景），不阻塞响应
          void this.reloadUserSkillsAfterWrite();
          return;
        }
      }

      // 市场技能更新（fallback）
      const adapter = await this.getClawHubAdapter();
      const skill = await adapter.updateSkill(decoded);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: true, skill }));
      this.broadcastEvent('skill:updated', { skill });
    } catch (err) {
      this.sendError(res, err);
    }
  }

  /**
   * 更新本地技能 SKILL.md（S2-1 ④：前端 PUT body → 本地内容更新）
   */
  private async updateLocalSkill(
    skillId: string,
    updates: Record<string, unknown>,
    skillMdPath: string
  ): Promise<Record<string, unknown>> {
    const raw = fs.readFileSync(skillMdPath, 'utf-8');
    const fmMatch = raw.match(/^---\n([\s\S]*?)\n---\n/);
    const oldBody = fmMatch ? raw.slice(fmMatch[0].length) : raw;
    const oldFm: Record<string, string> = {};
    if (fmMatch) {
      for (const line of fmMatch[1].split('\n')) {
        const m = line.match(/^(\w[\w-]*):\s*(.+)$/);
        if (m) oldFm[m[1]] = m[2].trim();
      }
    }

    const name = this.sanitizeSkillFrontmatterValue(
      String(updates.name ?? oldFm.name ?? skillId),
      200
    );
    const description = this.sanitizeSkillFrontmatterValue(
      String(updates.description ?? oldFm.description ?? ''),
      1000
    );
    const category = this.sanitizeSkillFrontmatterValue(
      String(updates.category ?? oldFm.category ?? 'general'),
      100
    );
    const bodyText =
      typeof updates.content === 'string' ? updates.content : oldBody;
    const version = oldFm.version ?? '1.0.0';

    const frontmatter = [
      '---',
      `name: ${name}`,
      `description: ${description}`,
      `category: ${category}`,
      `version: ${version}`,
      '---',
      '',
    ].join('\n');
    fs.writeFileSync(skillMdPath, `${frontmatter}\n${bodyText}`, 'utf-8');

    return {
      id: skillId,
      name,
      description,
      category,
      status: 'enabled',
      version,
      source: 'user',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
  }

  /**
   * 处理删除技能 DELETE /v1/skills/:id（v1.5 阶段 3：区分市场卸载与本地删除，修复 P2-2）
   */
  private async handleDeleteSkill(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    skillId: string
  ): Promise<void> {
    try {
      // S0-1：%2F 等解码后校验，防路径穿越删除
      const decoded = await this.validateSkillIdParam(skillId, res);
      if (decoded === null) return;
      const adapter = await this.getClawHubAdapter();

      // 市场安装技能（索引内）：uninstallSkill（删目录 + 索引 + registry）
      const installed = await adapter.getLocalStore().getSkill(decoded);
      if (installed) {
        await adapter.uninstallSkill(decoded);
        res.writeHead(200, {
          'Content-Type': 'application/json; charset=utf-8',
        });
        res.end(JSON.stringify({ success: true }));
        this.broadcastEvent('skill:deleted', { skillId: decoded });
        return;
      }

      // 本地技能（目录扫描）：删目录
      const { resolvePyappHome } = await import('@modules/core/paths');
      const userSkillsDir = path.join(resolvePyappHome(), 'skills');
      const skillDir = path.join(userSkillsDir, decoded);
      if (fs.existsSync(skillDir)) {
        fs.rmSync(skillDir, { recursive: true, force: true });
        res.writeHead(200, {
          'Content-Type': 'application/json; charset=utf-8',
        });
        res.end(JSON.stringify({ success: true }));
        this.broadcastEvent('skill:deleted', { skillId: decoded });
        // 删除后重载 registry，移除已注销用户技能（不阻塞响应）
        void this.reloadUserSkillsAfterWrite();
        return;
      }

      res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(
        JSON.stringify({
          error: { code: 'SKILL_NOT_FOUND', message: '技能未找到' },
        })
      );
    } catch (err) {
      this.sendError(res, err);
    }
  }

  /**
   * 本地技能启用状态落盘（5.4 导入审批闭环）
   * 本地目录技能（~/.pyapp/skills/<id>/SKILL.md，不在市场 index）以 `.enabled` 文件为状态真源：
   * 启用 = 删除标记；禁用 = 写 'false'。市场技能由 adapter 的 index.json 管理，此处跳过。
   */
  private async applyLocalSkillEnabled(
    skillId: string,
    enabled: boolean
  ): Promise<void> {
    try {
      // S0-1：非法 ID 直接跳过（如 %2F 解码后的路径穿越）
      const { validateSkillId } =
        await import('@modules/skills/loaders/adapter/safeSkillId');
      const idError = validateSkillId(skillId);
      if (idError) {
        logger.warn(`本地技能启用状态落盘跳过（非法 ID）: ${skillId}`, {
          error: idError,
        });
        return;
      }
      const { resolvePyappHome } = await import('@modules/core/paths');
      const skillDir = path.join(resolvePyappHome(), 'skills', skillId);
      if (!fs.existsSync(path.join(skillDir, 'SKILL.md'))) return;
      const enabledFile = path.join(skillDir, '.enabled');
      if (enabled) {
        fs.rmSync(enabledFile, { force: true });
      } else {
        fs.writeFileSync(enabledFile, 'false', 'utf-8');
      }
    } catch (error) {
      logger.warn(`本地技能启用状态落盘失败: ${skillId}`, {
        error: String(error),
      });
    }
  }

  private async handleEnableSkill(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    skillId: string
  ): Promise<void> {
    try {
      const adapter = await this.getClawHubAdapter();
      await adapter.enableSkill(skillId);
      await this.applyLocalSkillEnabled(skillId, true);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ id: skillId, status: 'enabled' }));
      this.broadcastEvent('skill:enabled', { skillId });
    } catch (err) {
      this.sendError(res, err);
    }
  }

  private async handleDisableSkill(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    skillId: string
  ): Promise<void> {
    try {
      const adapter = await this.getClawHubAdapter();
      await adapter.disableSkill(skillId);
      await this.applyLocalSkillEnabled(skillId, false);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ id: skillId, status: 'disabled' }));
      this.broadcastEvent('skill:disabled', { skillId });
    } catch (err) {
      this.sendError(res, err);
    }
  }

  // ========== Channel Handlers ==========

  private async handleUpdateChannel(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    channelId: string
  ): Promise<void> {
    try {
      const body = await this.readRequestBody(req);
      const parsedBody = body ? JSON.parse(body) : {};
      const { enabled, name, config } = parsedBody;

      // 仅切换启用/禁用
      if (enabled === undefined && name === undefined && config === undefined) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            error: {
              message: 'At least one of enabled/name/config is required',
            },
          })
        );
        return;
      }

      const { channelRegistry } =
        await import('@modules/channels/registry/ChannelRegistry');
      const channel = channelRegistry.get(channelId);
      if (!channel) {
        // 尝试动态注册：前端凭据足够时自动创建并注册通道插件
        const dynRegistered = await this.tryDynamicRegister(
          channelId,
          config as Record<string, unknown> | undefined
        );
        if (!dynRegistered) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: { message: 'Channel not found' } }));
          return;
        }
      }

      // 更新配置
      const channelAfterDyn = channelRegistry.get(channelId)!;
      channelRegistry.updateConfig(channelId, {
        name: name,
        enabled: enabled,
        options: config as Record<string, unknown> | undefined,
      });

      // 同步写入统一凭据存储（使 ChannelSecretStore 查询可用）
      if (
        config &&
        typeof config === 'object' &&
        Object.keys(config).length > 0
      ) {
        const { ChannelSecretStore } =
          await import('@modules/channels/secrets/ChannelSecretStore');
        ChannelSecretStore.getInstance().set(
          channelId,
          config as Record<string, unknown>
        );
      }

      // 如果 enabled 有变化，执行连接/断开
      if (enabled !== undefined) {
        if (enabled) {
          await channelRegistry.connect(channelId);
        } else {
          await channelRegistry.disconnect(channelId);
        }
      }

      // 读取最新状态
      const latestConfig = channelRegistry.getConfig(channelId);
      const latestChannel = channelRegistry.get(channelId);

      // P0-4：DB 中敏感字段为密文，回显解密
      let displayConfig: Record<string, unknown> = {};
      if (latestConfig?.options) {
        const { ChannelSecretStore } =
          await import('@modules/channels/secrets/ChannelSecretStore');
        displayConfig = ChannelSecretStore.getInstance().get(channelId);
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          id: channelId,
          name: name || channelAfterDyn.name,
          type: channelAfterDyn.type,
          enabled: enabled !== undefined ? enabled : channelAfterDyn.enabled,
          connected: latestChannel?.connected ?? channelAfterDyn.connected,
          registered: true,
          config: displayConfig,
        })
      );

      this.broadcastEvent('channel:updated', { id: channelId, enabled, name });
    } catch (err) {
      this.sendError(res, err);
    }
  }

  /**
   * 处理通道配置应用请求 POST /v1/channels/config/apply
   * 从 DB 中读取已保存的通道配置，重新注册并连接通道
   */
  private async handleApplyChannelConfig(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      const { channelRegistry } =
        await import('@modules/channels/registry/ChannelRegistry');

      // 获取所有已持久化的配置
      const savedConfigs = channelRegistry.getAllConfigs();

      // 对每个已保存但未注册的通道，尝试动态注册
      let registeredCount = 0;
      for (const config of savedConfigs) {
        const existing = channelRegistry.get(config.type);
        if (!existing) {
          // P0-4：DB 中敏感字段为密文，动态注册前解密
          const { ChannelSecretStore } =
            await import('@modules/channels/secrets/ChannelSecretStore');
          const decrypted = ChannelSecretStore.getInstance().get(config.type);
          const dynRegistered = await this.tryDynamicRegister(
            config.type,
            decrypted
          );
          if (dynRegistered) {
            registeredCount++;
            // 恢复持久化的配置（含 enabled 状态）——options 保留原样（密文或明文）
            channelRegistry.updateConfig(config.type, {
              name: config.name,
              enabled: config.enabled,
              options: config.options,
            });
          }
        }
      }

      // 连接所有已启用的通道
      const enabledChannels = channelRegistry.getEnabled();
      let connectedCount = 0;
      const errors: string[] = [];

      for (const channel of enabledChannels) {
        try {
          await channel.connect();
          connectedCount++;
        } catch (e) {
          const msg = `连接通道失败: ${channel.name} — ${e instanceof Error ? e.message : String(e)}`;
          void handleError(e, {
            module: 'infrastructure:http:local',
            action: 'connectChannel',
            context: { channelName: channel.name },
          });
          errors.push(msg);
        }
      }

      logger.info('通道配置应用完成', {
        registered: registeredCount,
        connected: connectedCount,
        errors: errors.length,
      });

      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(
        JSON.stringify({
          success: true,
          registered: registeredCount,
          connected: connectedCount,
          errors: errors.length > 0 ? errors : undefined,
        })
      );
    } catch (err) {
      await handleError(err, {
        module: 'infra:http',
        action: 'apply_channel_config',
      });
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(
        JSON.stringify({
          error: {
            message: '配置应用失败',
            detail: err instanceof Error ? err.message : String(err),
          },
        })
      );
    }
  }

  /**
   * 通道动态注册元信息表（26 通道全覆盖）
   * 与 setupChannels.ts 中的 channelCandidates 保持同步
   */
  private static readonly CHANNEL_TABLE: Array<{
    type: string;
    name: string;
    importPath: string;
    exportKey: string;
  }> = [
    {
      type: 'telegram',
      name: 'Telegram',
      importPath: '../../../channels/telegram/TelegramChannel',
      exportKey: 'telegramChannel',
    },
    {
      type: 'discord',
      name: 'Discord',
      importPath: '../../../channels/discord/DiscordChannel',
      exportKey: 'discordChannel',
    },
    {
      type: 'qq',
      name: 'QQ',
      importPath: '../../../channels/qq/QQChannel',
      exportKey: 'qqChannel',
    },
    {
      type: 'dingtalk',
      name: '钉钉',
      importPath: '../../../channels/dingtalk/DingTalkChannel',
      exportKey: 'dingtalkChannel',
    },
    {
      type: 'feishu',
      name: '飞书',
      importPath: '../../../channels/feishu/FeishuChannel',
      exportKey: 'feishuChannel',
    },
    {
      type: 'wechat',
      name: '微信',
      importPath: '../../../channels/wechat/WechatChannel',
      exportKey: 'wechatChannel',
    },
    {
      type: 'slack',
      name: 'Slack',
      importPath: '../../../channels/slack/index',
      exportKey: 'slackChannelPlugin',
    },
    {
      type: 'line',
      name: 'Line',
      importPath: '../../../channels/line/index',
      exportKey: 'lineChannelPlugin',
    },
    {
      type: 'irc',
      name: 'IRC',
      importPath: '../../../channels/irc/index',
      exportKey: 'ircChannelPlugin',
    },
    {
      type: 'nostr',
      name: 'Nostr',
      importPath: '../../../channels/nostr/index',
      exportKey: 'nostrChannelPlugin',
    },
    {
      type: 'email',
      name: '邮件',
      importPath: '../../../channels/email/EmailChannel',
      exportKey: 'emailChannelPlugin',
    },
    {
      type: 'sms',
      name: '短信',
      importPath: '../../../channels/sms/SmsChannel',
      exportKey: 'smsChannelPlugin',
    },
    {
      type: 'webhook',
      name: 'Webhook',
      importPath: '../../../channels/webhook/WebhookChannel',
      exportKey: 'webhookChannelPlugin',
    },
    {
      type: 'wecom',
      name: '企业微信',
      importPath: '../../../channels/wecom/WeComChannel',
      exportKey: 'wecomChannel',
    },
    {
      type: 'googlechat',
      name: 'Google Chat',
      importPath: '../../../channels/googlechat/index',
      exportKey: 'googleChatChannelPlugin',
    },
    {
      type: 'msteams',
      name: 'MS Teams',
      importPath: '../../../channels/msteams/index',
      exportKey: 'msteamsChannelPlugin',
    },
    {
      type: 'zalo',
      name: 'Zalo',
      importPath: '../../../channels/zalo/index',
      exportKey: 'zaloChannelPlugin',
    },
    {
      type: 'yuanbao',
      name: '元宝',
      importPath: '../../../channels/yuanbao/index',
      exportKey: 'yuanbaoChannelPlugin',
    },
    {
      type: 'whatsapp',
      name: 'WhatsApp',
      importPath: '../../../channels/whatsapp/index',
      exportKey: 'whatsAppChannelPlugin',
    },
    {
      type: 'signal',
      name: 'Signal',
      importPath: '../../../channels/signal/index',
      exportKey: 'signalChannelPlugin',
    },
    {
      type: 'matrix',
      name: 'Matrix',
      importPath: '../../../channels/matrix/index',
      exportKey: 'matrixChannelPlugin',
    },
    {
      type: 'facebook',
      name: 'Facebook Messenger',
      importPath: '../../../channels/facebookmessenger/index',
      exportKey: 'facebookMessengerChannelPlugin',
    },
    {
      type: 'twitter',
      name: 'Twitter/X',
      importPath: '../../../channels/twitter/index',
      exportKey: 'twitterChannelPlugin',
    },
    {
      type: 'claude',
      name: 'Claude',
      importPath: '../../../channels/claude/index',
      exportKey: 'claudeChannelPlugin',
    },
    {
      type: 'mattermost',
      name: 'Mattermost',
      importPath: '../../../channels/mattermost/MattermostChannel',
      exportKey: 'mattermostChannel',
    },
    {
      type: 'bluebubbles',
      name: 'iMessage',
      importPath: '../../../channels/bluebubbles/BlueBubblesChannel',
      exportKey: 'bluebubblesChannelPlugin',
    },
  ];

  /** CHANNEL_TABLE 的快速索引 */
  private static getChannelEntry(type: string) {
    return LocalHTTPService.CHANNEL_TABLE.find((e) => e.type === type);
  }

  /**
   * 尝试动态注册未注册的通道（前端提供凭据时自动注册）
   * 覆盖全部 26 个通道，通过 CHANNEL_TABLE 表驱动
   */
  private async tryDynamicRegister(
    channelType: string,
    config?: Record<string, unknown>
  ): Promise<boolean> {
    const entry = LocalHTTPService.getChannelEntry(channelType);
    if (!entry) return false;

    try {
      // 动态导入插件模块
      const mod = await import(entry.importPath);
      const plugin = (mod as Record<string, unknown>)[entry.exportKey] as
        | IChannelPlugin
        | undefined;
      if (!plugin) {
        logger.warning(
          `tryDynamicRegister: 未找到插件导出 — ${channelType}/${entry.exportKey}`
        );
        return false;
      }

      // 1. 注册到 ChannelRegistry
      const { channelRegistry } =
        await import('@modules/channels/registry/ChannelRegistry');
      const { adaptPluginToInterface } =
        await import('@modules/channels/registry/ChannelRegistry');
      channelRegistry.register(adaptPluginToInterface(plugin));

      // 2. 注册到 ChannelBootstrapper
      const { channelBootstrapper } =
        await import('../../channels/bootstrap/ChannelBootstrapper');
      channelBootstrapper.registerPluginChannel(channelType, () => plugin);

      // 3. 写入配置（合并前端传入的凭据）
      // P0-4：已存配置可能为密文，先解密再与前端明文合并，最后统一加密落库
      const { encryptOptions } =
        await import('@modules/channels/secrets/encryption');
      const { ChannelSecretStore } =
        await import('@modules/channels/secrets/ChannelSecretStore');
      const existingDecrypted =
        ChannelSecretStore.getInstance().get(channelType);
      channelRegistry.updateConfig(channelType, {
        name: entry.name,
        enabled: false,
        options: encryptOptions({
          ...existingDecrypted,
          ...(config || {}),
        }),
      });

      // 4. 绑定入站消息处理器（统一管线，P0-3）
      this.bindInboundHandler(channelType, plugin);

      return true;
    } catch (err) {
      await handleError(err, {
        module: 'infra:http',
        action: 'try_dynamic_register',
        context: { channelType },
      });
      return false;
    }
  }

  /** 绑定入站消息 → AI → 出站 回路（P0-3：内部走 routeChannelMessage 统一管线） */
  private bindInboundHandler(
    channelType: string,
    plugin: IChannelPlugin
  ): void {
    if (!plugin.inbound) return;

    const _processingMessages = new Set<string>();

    plugin.inbound.setMessageHandler(
      async (message: import('@modules/channels/types').MessageContext) => {
        // 帧级去重兜底（routeChannelMessage 内部另有 messageId/内容级去重）
        if (_processingMessages.has(message.messageId)) return;
        _processingMessages.add(message.messageId);

        try {
          const sender = message.senderName || message.senderId || 'unknown';
          const label = channelType.toUpperCase();
          logger.info(`[${label}] 收到消息: ${sender}`);

          const coreAPI = getCoreAPI();

          // 2026-08-06（P0-3）：动态注册通道统一走 routeChannelMessage 单管线，
          // 与 env 注册通道共享帧验证 + DM 策略授权 + 去重 + 共享会话写入 + Inbox 桥接。
          const { routeChannelMessage } =
            await import('@modules/channels/routing/messageRouter');
          await routeChannelMessage(message, {
            coreAPI,
            channelName: channelType,
            enableTracing: true,
            dmPolicy: {
              policy: plugin.security?.dmPolicy ?? 'open',
              allowFrom: plugin.security?.allowFrom ?? [],
            },
            onOutbound: async (content, target) => {
              logger.info(`[${label}] 回复消息`);
              if (plugin.outbound) {
                await plugin.outbound.sendText(target, content);
              }
            },
          });
        } catch (error) {
          await handleError(error, {
            module: 'infra:http',
            action: 'channel_inbound_message',
            context: { channelType, messageId: message.messageId },
          });
        } finally {
          setTimeout(() => {
            _processingMessages.delete(message.messageId);
          }, 3000);
        }
      }
    );
    logger.info(`[${channelType}] 入站消息处理器已绑定`);
  }

  // ========== Channel Plugin Handlers ==========

  /**
   * 列出已安装的渠道插件
   */
  private async handleListChannelPlugins(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      const { NpmDistributor } =
        await import('@modules/plugins/distribution/NpmDistributor');
      const distributor = new NpmDistributor();
      const installed = await distributor.listInstalled();

      const result = installed.map((p) => ({
        name: p.name,
        version: p.version,
        installed: true,
        installedAt: p.installedAt,
      }));

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch (err) {
      this.sendError(res, err);
    }
  }

  /**
   * 安装渠道插件（通过 npm）
   */
  private async handleInstallChannelPlugin(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      const body = await this.readRequestBody(req);
      const parsed = body ? JSON.parse(body) : {};
      const packageName = parsed.package as string | undefined;

      if (!packageName || typeof packageName !== 'string') {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({ error: { message: '"package" field is required' } })
        );
        return;
      }

      const { NpmDistributor } =
        await import('@modules/plugins/distribution/NpmDistributor');
      const distributor = new NpmDistributor();
      const result = await distributor.install(packageName);

      if (result.success) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            success: true,
            name: result.name,
            version: result.version,
            path: result.path,
          })
        );
      } else {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            success: false,
            error: result.error || 'Install failed',
          })
        );
      }
    } catch (err) {
      this.sendError(res, err);
    }
  }

  // ========== WeChat CLI Status Handler ==========

  /**
   * 获取 weixin-cli 当前状态（含二维码扫码信息）
   * 用于前端显示扫码登录界面
   */
  private async handleWechatCliStatus(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      const { WeixinCliManager } =
        await import('@modules/channels/wechat/cli-manager');
      const status = WeixinCliManager.getInstance().getStatus();

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, data: status }));
    } catch (err) {
      this.sendError(res, err);
    }
  }

  // ========== API Key Handlers ==========

  private apiKeys: Map<
    string,
    { name: string; key: string; createdAt: number }
  > = new Map();

  private async handleListApiKeys(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      const apiKeyList = Array.from(this.apiKeys.entries()).map(
        ([id, data]) => ({
          id,
          name: data.name,
          key_prefix: data.key.substring(0, 8),
          created_at: data.createdAt,
          permissions: ['read'],
        })
      );

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(apiKeyList));
    } catch (err) {
      this.sendError(res, err);
    }
  }

  private async handleCreateApiKey(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      const body = await this.readRequestBody(req);
      const { name } = JSON.parse(body);

      if (!name) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'name is required' } }));
        return;
      }

      const id = `key_${Date.now()}`;
      const key = `sk-${Math.random().toString(36).substr(2, 32)}`;

      this.apiKeys.set(id, { name, key, createdAt: Date.now() });

      res.writeHead(201, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          id,
          name,
          key,
          key_prefix: key.substring(0, 8),
          created_at: Date.now(),
          permissions: ['read'],
        })
      );
    } catch (err) {
      this.sendError(res, err);
    }
  }

  private async handleDeleteApiKey(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    keyId: string
  ): Promise<void> {
    try {
      if (!this.apiKeys.has(keyId)) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'API key not found' } }));
        return;
      }

      this.apiKeys.delete(keyId);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({}));
    } catch (err) {
      this.sendError(res, err);
    }
  }

  // ========== Memory Handlers ==========

  private memoryManagerInstance:
    | import('@modules/memory/MemoryManager').MemoryManagerImpl
    | null = null;

  private async getMemoryManager(): Promise<
    import('@modules/memory/MemoryManager').MemoryManagerImpl
  > {
    if (!this.memoryManagerInstance) {
      const { MemoryManagerImpl } =
        await import('@modules/memory/MemoryManager');
      this.memoryManagerInstance = new MemoryManagerImpl();
    }
    return this.memoryManagerInstance;
  }

  private async handleListMemories(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      const mm = await this.getMemoryManager();
      const memories = await mm.getAllMemories();

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, memories }));
    } catch (err) {
      this.sendError(res, err);
    }
  }

  private async handleSearchMemories(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      const parsedUrl = new URL(
        req.url!,
        `http://${req.headers.host || 'localhost'}`
      );
      const query = parsedUrl.searchParams.get('query') || '';
      if (!query) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'query is required' } }));
        return;
      }

      const mm = await this.getMemoryManager();
      const memories = await mm.getRelevantMemories(query);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, memories }));
    } catch (err) {
      this.sendError(res, err);
    }
  }

  private async handleGetMemory(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    memoryId: string
  ): Promise<void> {
    try {
      const mm = await this.getMemoryManager();
      const memory = await mm.getMemory(memoryId);

      if (!memory) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'Memory not found' } }));
        return;
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, memory }));
    } catch (err) {
      this.sendError(res, err);
    }
  }

  private async handleCreateMemory(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      const body = await this.readRequestBody(req);
      const params = JSON.parse(body);

      if (!params.content) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'content is required' } }));
        return;
      }

      const mm = await this.getMemoryManager();
      const memory = await mm.createMemory({
        content: params.content,
        metadata: {
          name: params.name || '',
          description: params.description || '',
          type: params.type || 'note',
          tags: params.tags || [],
          ...(params.metadata || {}),
        },
      });

      res.writeHead(201, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, memory }));
    } catch (err) {
      this.sendError(res, err);
    }
  }

  /**
   * 处理从文件创建记忆请求
   * POST /v1/memory/create-from-file
   * 读取文件内容，将其存入记忆系统
   */
  private async handleCreateMemoryFromFile(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      const body = await this.readRequestBody(req);
      const { filePath, name, tags } = JSON.parse(body);

      if (!filePath) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'filePath is required' } }));
        return;
      }

      // 沙箱权限检查
      if (
        !this.checkFilePathPermission(filePath, SandboxPermission.READ_FILE)
      ) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            error: { message: 'Access denied: file path not in whitelist' },
          })
        );
        return;
      }

      const { readFile } = await import('fs/promises');
      const { existsSync } = await import('fs');
      const { basename } = await import('path');

      if (!existsSync(filePath)) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'File not found' } }));
        return;
      }

      const content = await readFile(filePath, 'utf-8');
      const fileName = basename(filePath);

      const mm = await this.getMemoryManager();
      const now = new Date();
      const memory = await mm.createMemory({
        content,
        metadata: {
          name: name || fileName,
          description: `从文件 ${fileName} 导入`,
          type: 'knowledge',
          createdAt: now,
          updatedAt: now,
          tags: tags || ['file-import'],
          source: filePath,
        },
      });

      res.writeHead(201, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, memory, fileName }));
    } catch (err) {
      this.sendError(res, err);
    }
  }

  private async handleUpdateMemory(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    memoryId: string
  ): Promise<void> {
    try {
      const body = await this.readRequestBody(req);
      const updates = JSON.parse(body);

      const mm = await this.getMemoryManager();
      const memory = await mm.updateMemory(memoryId, updates);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, memory }));
    } catch (err) {
      this.sendError(res, err);
    }
  }

  private async handleDeleteMemory(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    memoryId: string
  ): Promise<void> {
    try {
      const mm = await this.getMemoryManager();
      await mm.deleteMemory(memoryId);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true }));
    } catch (err) {
      this.sendError(res, err);
    }
  }

  private async handleDeleteAllMemories(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      const mm = await this.getMemoryManager();
      const count = await mm.deleteAllMemories();

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, deletedCount: count }));
    } catch (err) {
      this.sendError(res, err);
    }
  }

  private async handleGetMemorySummary(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    memoryId: string
  ): Promise<void> {
    try {
      const mm = await this.getMemoryManager();
      const memory = await mm.getMemory(memoryId);

      if (!memory) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'Memory not found' } }));
        return;
      }

      const summary = {
        id: memory.id,
        contentPreview:
          memory.content.length > 200
            ? memory.content.slice(0, 200) + '...'
            : memory.content,
        type: memory.metadata.type || 'unknown',
        tags: memory.metadata.tags || [],
        createdAt: memory.createdAt,
        updatedAt: memory.updatedAt,
      };

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, summary }));
    } catch (err) {
      this.sendError(res, err);
    }
  }

  private async handleGetMemoryWeights(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      const mm = await this.getMemoryManager();
      const allMemories = await mm.getAllMemories();

      // v1.2: 单次遍历，按后端类型分组累加
      const countMap: Record<string, number> = {};
      const weightMap: Record<string, number> = {};
      const TYPE_MAP: Record<string, string> = {
        user_fact: 'conversation',
        user_preference: 'user_preference',
        project_knowledge: 'project_context',
        code_pattern: 'system',
        decision: 'knowledge',
      };
      for (const m of allMemories) {
        const backendType = m.metadata?.type || 'unknown';
        const ft = TYPE_MAP[backendType] || backendType;
        countMap[ft] = (countMap[ft] || 0) + 1;
        weightMap[ft] =
          (weightMap[ft] || 0) + Math.max(1, m.metadata?.priority || 0);
      }

      const weights = Object.keys(countMap).map((ft) => ({
        type: ft,
        count: countMap[ft],
        totalWeight: weightMap[ft] || 0,
        averageWeight:
          countMap[ft] > 0 ? (weightMap[ft] || 0) / countMap[ft] : 0,
      }));
      weights.sort((a, b) => b.count - a.count);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          success: true,
          weights,
          totalMemories: allMemories.length,
        })
      );
    } catch (err) {
      this.sendError(res, err);
    }
  }

  private async handleGetSyncStatus(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    // v1.2: 旧端点已废弃，返回 410 Gone
    res.writeHead(410, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        error: {
          message:
            'This endpoint has been removed. Use GET /v1/memory/stats instead.',
        },
      })
    );
  }

  private async handleGetStats(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      const mm = await this.getMemoryManager();
      const allMemories = await mm.getAllMemories();
      const now = Date.now();
      const TYPE_MAP: Record<string, string> = {
        user_fact: 'conversation',
        user_preference: 'user_preference',
        project_knowledge: 'project_context',
        code_pattern: 'system',
        decision: 'knowledge',
      };

      const withVectors = allMemories.filter(
        (m) => !!(m.metadata as unknown as Record<string, unknown>)['vectorId']
      ).length;
      const byType: Record<string, number> = {};
      for (const m of allMemories) {
        const ft =
          TYPE_MAP[m.metadata?.type || 'unknown'] ||
          m.metadata?.type ||
          'unknown';
        byType[ft] = (byType[ft] || 0) + 1;
      }
      const recentCount = allMemories.filter(
        (m) => now - new Date(m.createdAt).getTime() < 7 * 24 * 60 * 60 * 1000
      ).length;

      const expiring = await mm.getExpiringMemories();
      const oldestMs =
        allMemories.length > 0
          ? Math.min(...allMemories.map((m) => new Date(m.createdAt).getTime()))
          : now;
      const oldestMemoryAge = Math.floor(
        (now - oldestMs) / (24 * 60 * 60 * 1000)
      );

      const indexedCount = mm.getRetriever().getIndexSize();
      const vectorCacheSize = allMemories.filter(
        (m) => !!(m.metadata as unknown as Record<string, unknown>)['vectorId']
      ).length;

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          success: true,
          stats: {
            totalMemories: allMemories.length,
            withVectors,
            byType,
            recentCount,
            aging: {
              expiringCount: expiring.length,
              oldestMemoryAge,
              lastCleanupAt: mm.getLastCleanupAt(),
            },
            index: { indexedCount, vectorCacheSize },
          },
        })
      );
    } catch (err) {
      this.sendError(res, err);
    }
  }

  private async handleSyncMemories(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      const mm = await this.getMemoryManager();
      const cleanedCount = await mm.cleanupExpiredMemories();
      await mm.buildMemoryIndex();
      const remainingCount = (await mm.getAllMemories()).length;

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          success: true,
          result: { cleanedCount, remainingCount, reindexed: true },
        })
      );
    } catch (err) {
      this.sendError(res, err);
    }
  }

  private async handleConsolidateMemories(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      const mm = await this.getMemoryManager();
      const allMemories = await mm.getAllMemories();

      const { MemoryConsolidator } =
        await import('../../../src/memory/consolidation/MemoryConsolidator');
      const consolidator = new MemoryConsolidator({
        similarityThreshold: 0.85,
      });
      const dedupResult = consolidator.findDuplicates(
        allMemories.map((m) => ({
          id: m.id,
          content: m.content,
          createdAt: new Date(m.createdAt).getTime(),
        }))
      );

      const removedIds: string[] = [];
      try {
        for (const group of dedupResult.duplicates) {
          for (let i = 1; i < group.length; i++) {
            await mm.deleteMemory(group[i]);
            removedIds.push(group[i]);
          }
        }
      } finally {
        await mm.buildMemoryIndex();
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          success: true,
          result: {
            duplicateGroups: dedupResult.duplicates.length,
            totalRemoved: dedupResult.totalRemoved,
            spaceSaved: dedupResult.spaceSaved,
            removedIds,
          },
        })
      );
    } catch (err) {
      this.sendError(res, err);
    }
  }

  private async handleDreamMemories(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      const mm = await this.getMemoryManager();
      const { runMemoryDream } =
        await import('../../../src/memory/consolidation/MemoryDreamService');
      const result = await runMemoryDream(mm);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, result }));
    } catch (err) {
      this.sendError(res, err);
    }
  }

  private async handleDreamCyclesList(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      const parsedUrl = new URL(
        req.url!,
        `http://${req.headers.host || 'localhost'}`
      );
      const { DreamPersistence } =
        await import('../../../src/dream/DreamPersistence');
      const persistence = new DreamPersistence();

      const result = await persistence.listCycles({
        page: parseInt(parsedUrl.searchParams.get('page') || '1'),
        pageSize: parseInt(parsedUrl.searchParams.get('pageSize') || '20'),
        triggerSource: parsedUrl.searchParams.get('triggerSource') || undefined,
        status: parsedUrl.searchParams.get('status') || undefined,
        startTime: parsedUrl.searchParams.get('startTime')
          ? parseInt(parsedUrl.searchParams.get('startTime')!)
          : undefined,
        endTime: parsedUrl.searchParams.get('endTime')
          ? parseInt(parsedUrl.searchParams.get('endTime')!)
          : undefined,
        sortOrder:
          (parsedUrl.searchParams.get('sortOrder') as 'asc' | 'desc') || 'desc',
      });

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, ...result }));
    } catch (err) {
      this.sendError(res, err);
    }
  }

  private async handleDreamCycleDetail(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    cycleId: string
  ): Promise<void> {
    try {
      const { DreamPersistence } =
        await import('../../../src/dream/DreamPersistence');
      const persistence = new DreamPersistence();
      const cycle = await persistence.getCycle(cycleId);

      if (!cycle) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            error: { message: 'Dream cycle not found', cycleId },
          })
        );
        return;
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, cycle }));
    } catch (err) {
      this.sendError(res, err);
    }
  }

  /**
   * 处理文件打开请求
   * GET /api/file/open?path=<encoded_path>
   * 在 Tauri WebView 中点击文件链接时调用，通过 child_process 在系统默认程序中打开文件
   */
  private async handleFileOpen(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      const parsedUrl = new URL(
        req.url!,
        `http://${req.headers.host || 'localhost'}`
      );
      const filePath = parsedUrl.searchParams.get('path');

      if (!filePath) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({ error: { message: 'Missing path parameter' } })
        );
        return;
      }

      // 安全校验：路径必须在 pyappHome 范围内
      const { isPathWithin, resolvePyappHome } =
        await import('@modules/core/paths');
      const home = resolvePyappHome();
      if (!isPathWithin(home, filePath)) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            error: { message: 'Access denied: path outside allowed directory' },
          })
        );
        return;
      }

      // 安全校验：禁止文件名含双引号，防止命令注入
      if (filePath.includes('"')) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            error: { message: 'Invalid path: contains illegal characters' },
          })
        );
        return;
      }

      // 使用 spawn 替代 exec 避免 shell 解析注入（& | ; 等字符）
      const { spawn } = await import('child_process');
      if (process.platform === 'win32') {
        const child = spawn('cmd', ['/c', 'start', '""', filePath], {
          shell: false,
          stdio: 'ignore',
          detached: true,
        });
        child.unref();
      } else if (process.platform === 'darwin') {
        const child = spawn('open', [filePath], {
          shell: false,
          stdio: 'ignore',
          detached: true,
        });
        child.unref();
      } else {
        const child = spawn('xdg-open', [filePath], {
          shell: false,
          stdio: 'ignore',
          detached: true,
        });
        child.unref();
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true }));
    } catch (err) {
      await handleError(err, {
        module: 'infra:http',
        action: 'file_open',
        context: { path: req.url },
      });
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: {
            message: `Failed to open file: ${err instanceof Error ? err.message : String(err)}`,
          },
        })
      );
    }
  }

  /**
   * 处理文件读取请求
   * GET /api/file/read?path=<encoded_path>
   * 读取文件内容并返回，支持代码/Markdown/JSON/图片等类型
   */
  private async handleFileRead(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      const parsedUrl = new URL(
        req.url!,
        `http://${req.headers.host || 'localhost'}`
      );
      const filePath = parsedUrl.searchParams.get('path');

      if (!filePath) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({ error: { message: 'Missing path parameter' } })
        );
        return;
      }

      // 安全校验：路径必须在 pyappHome 范围内
      const { isPathWithin, resolvePyappHome } =
        await import('@modules/core/paths');
      const home = resolvePyappHome();
      if (!isPathWithin(home, filePath)) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'Access denied' } }));
        return;
      }

      // 检查文件是否存在
      if (!fs.existsSync(filePath)) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({ error: { message: `File not found: ${filePath}` } })
        );
        return;
      }

      const stats = fs.statSync(filePath);
      const size = stats.size;

      // 判断文件 MIME 类型
      const ext = path.extname(filePath).toLowerCase();
      const mimeTypes: Record<string, string> = {
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.gif': 'image/gif',
        '.svg': 'image/svg+xml',
        '.webp': 'image/webp',
        '.ico': 'image/x-icon',
        '.bmp': 'image/bmp',
      };

      // 图片文件：返回 base64
      if (mimeTypes[ext]) {
        const imageBuffer = fs.readFileSync(filePath);
        const base64 = imageBuffer.toString('base64');
        const dataUri = `data:${mimeTypes[ext]};base64,${base64}`;

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            content: dataUri,
            type: 'image',
            size,
            language: undefined,
          })
        );
        return;
      }

      // 不支持预览的二进制文件
      const binaryExts = [
        '.exe',
        '.zip',
        '.rar',
        '.7z',
        '.gz',
        '.tar',
        '.dll',
        '.so',
        '.dylib',
        '.bin',
        '.dat',
        '.wasm',
        '.pdf',
      ];
      if (binaryExts.includes(ext)) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            content: `不支持预览该文件类型 (${ext})`,
            type: 'text',
            size,
            language: undefined,
          })
        );
        return;
      }

      // 文本文件：读取内容
      const maxPreviewSize = 1 * 1024 * 1024; // 1MB
      let content: string;
      if (size > maxPreviewSize) {
        const fd = fs.openSync(filePath, 'r');
        const buffer = Buffer.alloc(maxPreviewSize);
        fs.readSync(fd, buffer, 0, maxPreviewSize, 0);
        fs.closeSync(fd);
        content =
          buffer.toString('utf-8') + '\n\n... 文件过大，仅显示前 1MB 内容';
      } else {
        content = fs.readFileSync(filePath, 'utf-8');
      }

      // 根据扩展名判断类型和语言
      const typeMap: Record<string, { type: string; language?: string }> = {
        '.ts': { type: 'code', language: 'typescript' },
        '.tsx': { type: 'code', language: 'tsx' },
        '.js': { type: 'code', language: 'javascript' },
        '.jsx': { type: 'code', language: 'jsx' },
        '.py': { type: 'code', language: 'python' },
        '.rs': { type: 'code', language: 'rust' },
        '.go': { type: 'code', language: 'go' },
        '.java': { type: 'code', language: 'java' },
        '.c': { type: 'code', language: 'c' },
        '.cpp': { type: 'code', language: 'cpp' },
        '.h': { type: 'code', language: 'c' },
        '.hpp': { type: 'code', language: 'cpp' },
        '.css': { type: 'code', language: 'css' },
        '.scss': { type: 'code', language: 'scss' },
        '.html': { type: 'code', language: 'html' },
        '.xml': { type: 'code', language: 'xml' },
        '.yaml': { type: 'yaml', language: 'yaml' },
        '.yml': { type: 'yaml', language: 'yaml' },
        '.toml': { type: 'yaml', language: 'toml' },
        '.json': { type: 'json', language: 'json' },
        '.md': { type: 'markdown', language: 'markdown' },
        '.mdx': { type: 'markdown', language: 'mdx' },
        '.txt': { type: 'text', language: undefined },
        '.log': { type: 'text', language: undefined },
        '.csv': { type: 'text', language: undefined },
        '.env': { type: 'text', language: undefined },
        '.sql': { type: 'code', language: 'sql' },
        '.sh': { type: 'code', language: 'bash' },
        '.bash': { type: 'code', language: 'bash' },
        '.zsh': { type: 'code', language: 'bash' },
        '.ps1': { type: 'code', language: 'powershell' },
        '.bat': { type: 'code', language: 'batch' },
        '.cmd': { type: 'code', language: 'batch' },
        '.rb': { type: 'code', language: 'ruby' },
        '.php': { type: 'code', language: 'php' },
        '.swift': { type: 'code', language: 'swift' },
        '.kt': { type: 'code', language: 'kotlin' },
        '.scala': { type: 'code', language: 'scala' },
        '.r': { type: 'code', language: 'r' },
        '.lua': { type: 'code', language: 'lua' },
        '.dart': { type: 'code', language: 'dart' },
        '.vue': { type: 'code', language: 'vue' },
        '.svelte': { type: 'code', language: 'svelte' },
        '.astro': { type: 'code', language: 'astro' },
        '.graphql': { type: 'code', language: 'graphql' },
        '.prisma': { type: 'code', language: 'prisma' },
        '.tf': { type: 'code', language: 'hcl' },
        '.dockerfile': { type: 'code', language: 'dockerfile' },
        '.makefile': { type: 'code', language: 'makefile' },
      };

      const fileInfo = typeMap[ext] || { type: 'text', language: undefined };

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          content,
          type: fileInfo.type,
          size,
          language: fileInfo.language,
        })
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await handleError(err, {
        module: 'infra:http',
        action: 'file_read',
        context: { path: req.url },
      });
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: { message: `Failed to read file: ${message}` },
        })
      );
    }
  }

  /**
   * 处理获取基础路径请求
   * GET /api/file/paths
   * 返回所有已知的基础目录路径，供前端解析不完整的文件路径使用
   */
  private async handleFilePaths(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    const {
      resolveProjectRoot,
      resolvePyappHome,
      resolveOutputDir,
      resolveDownloadsDir,
      resolveDataDir,
      resolveDocsDir,
    } = await import('@modules/core/paths');
    const projectRoot = resolveProjectRoot();
    const basePaths = {
      projectRoot,
      pyappHome: resolvePyappHome(),
      outputDir: resolveOutputDir(),
      downloadsDir: resolveDownloadsDir(),
      dataDir: resolveDataDir(),
      docsDir: resolveDocsDir(),
      appDir: path.join(projectRoot, 'app'),
      clientDir: path.join(projectRoot, 'client'),
    };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(basePaths));
  }

  /**
   * 处理文件路径解析请求
   * GET /api/file/resolve-path?path=<encoded_path>
   * 将可能不完整的文件路径解析为完整的绝对路径
   * 如果路径已存在，直接返回；否则依次在各基础目录下尝试查找
   */
  private async handleFileResolvePath(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      const parsedUrl = new URL(
        req.url!,
        `http://${req.headers.host || 'localhost'}`
      );
      const rawPath = parsedUrl.searchParams.get('path');

      if (!rawPath) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({ error: { message: 'Missing path parameter' } })
        );
        return;
      }

      const {
        resolveProjectRoot,
        resolvePyappHome,
        resolveOutputDir,
        resolveDownloadsDir,
        resolveDataDir,
        resolveDocsDir,
        isPathWithin,
        containsPathTraversal,
      } = await import('@modules/core/paths');

      // BUG-C 修复：绝对路径必须验证在允许范围内
      if (path.isAbsolute(rawPath)) {
        const pyappHome = resolvePyappHome();
        if (!isPathWithin(pyappHome, rawPath)) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              resolvedPath: rawPath,
              exists: false,
              restricted: true,
            })
          );
          return;
        }
        if (fs.existsSync(rawPath)) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ resolvedPath: rawPath, exists: true }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ resolvedPath: rawPath, exists: false }));
        return;
      }

      if (rawPath.startsWith('~')) {
        const pyappHome = resolvePyappHome();
        const withoutTilde = rawPath.replace(/^~[/\\]?/, '');
        // BUG-D 修复：禁止 tilde 展开后的路径遍历
        if (containsPathTraversal(withoutTilde)) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              resolvedPath: rawPath,
              exists: false,
              restricted: true,
            })
          );
          return;
        }
        const fullPath = path.join(pyappHome, withoutTilde);
        if (fs.existsSync(fullPath)) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ resolvedPath: fullPath, exists: true }));
          return;
        }
      }

      const projectRoot = resolveProjectRoot();
      const baseDirs = [
        projectRoot,
        resolvePyappHome(),
        resolveOutputDir(),
        resolveDownloadsDir(),
        resolveDataDir(),
        resolveDocsDir(),
        path.join(projectRoot, 'app'),
        path.join(projectRoot, 'client'),
      ];

      for (const baseDir of baseDirs) {
        const candidate = path.join(baseDir, rawPath);
        if (fs.existsSync(candidate)) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ resolvedPath: candidate, exists: true }));
          return;
        }
      }

      const guessedPath = path.join(projectRoot, rawPath);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ resolvedPath: guessedPath, exists: false }));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await handleError(err, {
        module: 'infra:http',
        action: 'file_resolve_path',
        context: { path: req.url },
      });
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: { message: `Failed to resolve path: ${message}` },
        })
      );
    }
  }

  /**
   * 处理文件预览转换请求
   * GET /api/file/preview?path=<encoded_path>
   * 对 Office 文件（pdf/docx/pptx）自动转换为 Markdown 后返回，
   * 非 Office 文件降级为纯文本预览（用于前端在转换失败时的兜底展示）
   */
  private async handleFilePreview(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      const parsedUrl = new URL(
        req.url!,
        `http://${req.headers.host || 'localhost'}`
      );
      const filePath = parsedUrl.searchParams.get('path');

      if (!filePath) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({ error: { message: 'Missing path parameter' } })
        );
        return;
      }

      // 安全校验：路径必须在 pyappHome 范围内
      const { isPathWithin, resolvePyappHome } =
        await import('@modules/core/paths');
      const home = resolvePyappHome();
      if (!isPathWithin(home, filePath)) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'Access denied' } }));
        return;
      }

      if (!fs.existsSync(filePath)) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({ error: { message: `File not found: ${filePath}` } })
        );
        return;
      }

      const stats = fs.statSync(filePath);
      const ext = path.extname(filePath).toLowerCase();

      // Office 文件扩展名：使用 ConverterEngine 转为 Markdown
      const officeExts = ['.pdf', '.docx', '.pptx', '.xlsx'];

      if (officeExts.includes(ext)) {
        const coreAPI = getCoreAPI();
        const result = await coreAPI.convertFile({ filePath });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            content: result.markdown,
            type: 'markdown',
            size: stats.size,
            language: 'markdown',
            title: result.title,
          })
        );
        return;
      }

      // 非 Office 文件：读取纯文本内容降级预览
      const content = fs.readFileSync(filePath, 'utf-8');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          content,
          type: 'text',
          size: stats.size,
        })
      );
    } catch (err) {
      await handleError(err, {
        module: 'infra:http',
        action: 'file_preview',
        context: { path: req.url },
      });
      const message = err instanceof Error ? err.message : String(err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: { message: `Failed to preview file: ${message}` },
        })
      );
    }
  }

  // ========== Checkpoint Handlers ==========

  /**
   * 创建检查点 POST /v1/checkpoints
   * { sessionId, label }
   */
  private async handleCreateCheckpoint(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      const body = await this.readRequestBody(req);
      const { sessionId, label } = JSON.parse(body);
      const chatManager = createChatManager();
      const cpId = await chatManager.createCheckpoint(sessionId, label);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ id: cpId, sessionId, label }));
    } catch (err) {
      this.sendError(res, err);
    }
  }

  /**
   * 列出检查点 GET /v1/checkpoints?sessionId=...
   */
  private async handleListCheckpoints(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      const urlObj = new URL(req.url!, `http://${req.headers.host}`);
      const sessionId = urlObj.searchParams.get('sessionId') || '';
      const chatManager = createChatManager();
      const checkpoints = await chatManager.listCheckpoints(sessionId);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(checkpoints));
    } catch (err) {
      this.sendError(res, err);
    }
  }

  /**
   * 获取检查点详情 GET /v1/checkpoints/:id
   */
  private async handleGetCheckpoint(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    cpId: string
  ): Promise<void> {
    try {
      const chatManager = createChatManager();
      const allCheckpoints = await chatManager.listCheckpoints('');
      let checkpoint: unknown = allCheckpoints.find((cp) => cp.id === cpId);
      if (!checkpoint) {
        const cp = await (
          chatManager as unknown as {
            getCheckpoint?: (id: string) => Promise<unknown>;
          }
        ).getCheckpoint?.(cpId);
        if (cp) checkpoint = cp;
      }
      if (!checkpoint) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'Checkpoint not found' } }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(checkpoint));
    } catch (err) {
      this.sendError(res, err);
    }
  }

  /**
   * 回滚到检查点 POST /v1/checkpoints/:id/rollback
   */
  private async handleRollbackCheckpoint(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    cpId: string
  ): Promise<void> {
    try {
      const chatManager = createChatManager();
      await chatManager.rollbackToCheckpoint(cpId);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, checkpointId: cpId }));
    } catch (err) {
      this.sendError(res, err);
    }
  }

  /**
   * 删除检查点 DELETE /v1/checkpoints/:id
   */
  private async handleDeleteCheckpoint(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    cpId: string
  ): Promise<void> {
    try {
      const chatManager = createChatManager();
      await chatManager.deleteCheckpoint(cpId);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, checkpointId: cpId }));
    } catch (err) {
      this.sendError(res, err);
    }
  }

  // ========== Semantic Index Handlers ==========

  /**
   * 构建语义索引 POST /v1/semantic/index
   */
  private async handleBuildSemanticIndex(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      const body = await this.readRequestBody(req);
      const { rootDir, incremental = true } = JSON.parse(body);
      const { IndexBuilder } =
        await import('@modules/knowledge/semantic/builder');
      const builder = new IndexBuilder();
      const result = await builder.build({
        rootDir,
        incremental,
        embedProvider: 'local',
        onProgress: (phase, done, total) => {
          // 进度日志节流：embedding 阶段每 100 条或最后一条才记录，避免高频刷屏
          if (phase === 'embedding' && done < total && done % 100 !== 0) return;
          logger.info(`Semantic index building: ${phase} ${done}/${total}`);
        },
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch (err) {
      this.sendError(res, err);
    }
  }

  /**
   * 语义搜索 GET /v1/semantic/search?q=...&topK=10
   */
  private async handleSearchSemantic(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      const urlObj = new URL(req.url!, `http://${req.headers.host}`);
      const query = urlObj.searchParams.get('q');
      const topK = parseInt(urlObj.searchParams.get('topK') || '10', 10);
      const minScore = parseFloat(urlObj.searchParams.get('minScore') || '0.3');

      if (!query) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({ error: { message: 'q parameter is required' } })
        );
        return;
      }

      const { SemanticStore } =
        await import('@modules/knowledge/semantic/store');
      const { globalEmbeddingManager } =
        await import('@modules/ai/embedding/EmbeddingManager');
      const { resolveDataSubDir } = await import('@modules/core/paths');
      const store = new SemanticStore(resolveDataSubDir('semantic-index'), {
        provider: 'local',
        model: 'nomic-embed-text',
      });
      await store.load();

      await globalEmbeddingManager.initialize();
      const embedding = await globalEmbeddingManager.embedOne(query);
      if (embedding.length === 0) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'Embedding failed' } }));
        return;
      }
      const hits = store.search(new Float32Array(embedding), topK, minScore);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(hits));
    } catch (err) {
      this.sendError(res, err);
    }
  }

  /**
   * 获取索引状态 GET /v1/semantic/index/status
   */
  private async handleGetSemanticIndexStatus(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      const { SemanticStore, readIndexMeta } =
        await import('@modules/knowledge/semantic/store');
      const { resolveDataSubDir } = await import('@modules/core/paths');
      const store = new SemanticStore(resolveDataSubDir('semantic-index'), {
        provider: 'ollama',
        model: 'all-minilm',
      });
      await store.load();

      const meta = await readIndexMeta(resolveDataSubDir('semantic-index'));
      const status = {
        entryCount: store.size,
        indexExists: meta !== null,
        meta,
      };

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(status));
    } catch (err) {
      this.sendError(res, err);
    }
  }

  /**
   * 清除语义索引 DELETE /v1/semantic/index
   */
  private async handleClearSemanticIndex(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      const { wipeStoreFiles } =
        await import('@modules/knowledge/semantic/store');
      const { resolveDataSubDir } = await import('@modules/core/paths');
      await wipeStoreFiles(resolveDataSubDir('semantic-index'));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true }));
    } catch (err) {
      this.sendError(res, err);
    }
  }
}

/**
 * LocalHTTPService 全局单例
 */
let _localHTTPService: LocalHTTPService | null = null;

/**
 * 获取 LocalHTTPService 单例
 */
export function getLocalHTTPService(): LocalHTTPService {
  if (!_localHTTPService) {
    _localHTTPService = new LocalHTTPService({
      host: '127.0.0.1',
      port: 7890,
    });
  }
  return _localHTTPService;
}
