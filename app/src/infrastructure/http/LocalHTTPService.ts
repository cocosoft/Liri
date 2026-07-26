/**
 * LocalHTTPService 本地 HTTP API 服务
 * 提供 OpenAI 兼容的 API 接口，允许 Tauri 客户端通过 HTTP 调用 CoreAPI
 *
 * 注意：本文件位于 core/gateway/local/（遗留 Gateway 体系目录），
 * 但实际消费 channels/ 目录下的 IChannelPlugin 接口。
 * 此位置具有误导性，后续应考虑迁移至 modules/ 下的合适位置。
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- legacy code with dynamic types */

import http from 'http';
import fs from 'fs';
import path from 'path';
import { Logger, LogLevel } from '@modules/monitoring';
import { handleError } from '@modules/error';
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
import {
  handleChatCompletions,
  handleQuestionAnswer,
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
import { handleEvents } from './handlers/config-handlers';
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

/**
 * LocalHTTPService 类
 * 提供本地 HTTP API 服务，对接 CoreAPI
 */
export class LocalHTTPService {
  private server: http.Server | null = null;
  private config: LocalHTTPConfig;
  private _isRunning = false;
  private readonly apiSecret: string;
  private compileScheduler: any = null;
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

    return new Promise((resolve, reject) => {
      this.server!.listen(this.config.port, this.config.host, () => {
        this._isRunning = true;
        logger.info(
          `LocalHTTPService 已启动: http://${this.config.host}:${this.config.port}`
        );
        // 异步初始化知识库种子，不阻塞启动
        this.seedKnowledgeBaseIfEmpty().catch((err) =>
          logger.warning('知识库种子初始化失败（非关键错误）', {
            error: String(err),
          })
        );
        this.startCompileScheduler().catch((err) =>
          logger.warning('编译调度器启动失败（非关键错误）', {
            error: String(err),
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
      this.compileScheduler.stop();
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
    res.setHeader('Access-Control-Allow-Origin', '*');
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

    // 共享密钥校验：确保请求来自被授权的 Tauri 客户端
    if (!this.verifyRequestAuth(req)) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Unauthorized' } }));
      return;
    }

    const url = req.url?.split('?')[0] || '';

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
      (event: string, data: any) => this.broadcastEvent(event, data),
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

    const endpoint = new CostReportEndpoint(costTracker);
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
      const { costTracker } = await import('@modules/cost/CostTracker');

      const modelUsage = costTracker.getModelUsage();
      const providers: Record<
        string,
        {
          cost: number;
          inputTokens: number;
          outputTokens: number;
          totalTokens: number;
          requests: number;
        }
      > = {};

      for (const [model, usage] of Object.entries(modelUsage)) {
        // 使用模型名作为 provider
        providers[model] = {
          cost: usage.costUSD,
          inputTokens: usage.inputTokens || 0,
          outputTokens: usage.outputTokens || 0,
          totalTokens: (usage.inputTokens || 0) + (usage.outputTokens || 0),
          requests: 1,
        };
      }

      const topProviders = Object.entries(providers)
        .map(([provider, data]) => ({
          provider,
          ...data,
          percentage: 0,
        }))
        .sort((a, b) => b.cost - a.cost)
        .slice(0, 5);

      // 计算总百分比
      const totalCost = topProviders.reduce((sum, p) => sum + p.cost, 0);
      topProviders.forEach((p) => {
        p.percentage = totalCost > 0 ? (p.cost / totalCost) * 100 : 0;
      });

      const totalInputTokens = costTracker.getTotalInputTokens();
      const totalOutputTokens = costTracker.getTotalOutputTokens();

      const response = {
        totalSessions: 0,
        todayCost: costTracker.getTotalCostUSD(),
        weeklyCost: costTracker.getTotalCostUSD(),
        monthlyCost: costTracker.getTotalCostUSD(),
        yearlyCost: costTracker.getTotalCostUSD(),
        todayTokens: totalInputTokens + totalOutputTokens,
        monthlyTokens: totalInputTokens + totalOutputTokens,
        totalInputTokens,
        totalOutputTokens,
        totalTokens: totalInputTokens + totalOutputTokens,
        totalCacheReadTokens: costTracker.getTotalCacheReadInputTokens(),
        totalCacheCreationTokens:
          costTracker.getTotalCacheCreationInputTokens(),
        totalRequests: Object.keys(modelUsage).length,
        sessionCost: costTracker.getTotalCostUSD(),
        sessionInputTokens: totalInputTokens,
        sessionOutputTokens: totalOutputTokens,
        sessionTokens: totalInputTokens + totalOutputTokens,
        topProviders,
        dailyBreakdown: [],
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
      const { costTracker } = await import('@modules/cost/CostTracker');
      const modelUsage = costTracker.getModelUsage();

      const records = Object.entries(modelUsage).map(
        ([model, usage], index) => ({
          id: `cost-${index}`,
          date: new Date().toISOString().split('T')[0],
          provider: model,
          model,
          promptTokens: usage.inputTokens || 0,
          completionTokens: usage.outputTokens || 0,
          totalTokens: (usage.inputTokens || 0) + (usage.outputTokens || 0),
          cacheReadTokens: 0,
          cacheCreationTokens: 0,
          cost: usage.costUSD,
          currency: 'USD',
        })
      );

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ records, total: records.length }));
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
      const { costTracker } = await import('@modules/cost/CostTracker');
      const modelUsage = costTracker.getModelUsage();

      const records = Object.entries(modelUsage).map(
        ([model, usage], index) => ({
          id: `cost-${index}`,
          date: new Date().toISOString().split('T')[0],
          provider: model,
          model,
          promptTokens: usage.inputTokens || 0,
          completionTokens: usage.outputTokens || 0,
          totalTokens: (usage.inputTokens || 0) + (usage.outputTokens || 0),
          cacheReadTokens: 0,
          cacheCreationTokens: 0,
          cost: usage.costUSD,
          currency: 'USD',
        })
      );

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(records));
    } catch (err) {
      await handleError(err, {
        module: 'infra:http',
        action: 'global_cost_range',
      });
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: '获取成本范围数据失败' } }));
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
    } catch (err) {
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
    } catch (err) {
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
   */
  private async handleEvents(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    return handleEvents(this._handlerCtx, req, res);
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
      const result = commands.map((cmd: any) => ({
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
      } catch (err) {
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
    fs: any,
    path: any
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
        } catch (err) {
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
        } catch (err) {
          // 非致命：标记写入失败不影响目录切换
        }
      }

      // 设置全局覆盖
      setUserDataDirOverride(resolvedDir);

      // 持久化到用户设置
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
    fs: any,
    path: any,
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
          } catch (err) {
            // 静默忽略清理中的个别错误
          }
        }
      }
    } catch (err) {
      // 回滚清理失败不影响主流程，数据保留在原目录
    }
  }

  // ──────────────────────────────────────────────
  // Skills（ClawHub 生态对接）处理器
  // ──────────────────────────────────────────────

  /**
   * 获取 ClawHubAdapter 实例
   * 优先从 ThirdPartyAdapterRegistry 获取，fallback 到直接 import
   */
  private async getClawHubAdapter(): Promise<any> {
    // 优先从注册表获取
    try {
      const { thirdPartyAdapterRegistry } =
        await import('@modules/skills/loaders/adapter/ThirdPartyAdapterRegistry');
      const registered = thirdPartyAdapterRegistry.get('clawhub');
      if (registered) {
        return registered;
      }
    } catch (err) {
      // 注册表不可用时 fallback
    }

    // Fallback: 直接 import
    const { ClawHubAdapter } =
      await import('@modules/skills/loaders/adapter/clawhub/ClawHubAdapter');

    const adapter = ClawHubAdapter.getInstance();

    if (!adapter['initialized']) {
      await adapter.initialize();
    }

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
      const { existsSync } = await import('fs');
      const { join } = await import('path');

      const skills: Record<string, any>[] = [];
      const seen = new Set<string>();

      const scanDir = async (dir: string, source: string) => {
        if (!existsSync(dir)) return;
        const entries = await readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
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
              const fm = parsed.frontmatter as Record<string, any>;
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
              } catch (err) {
                /* use defaults */
              }

              skills.push({
                id: name,
                name,
                description,
                status: 'enabled',
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
            } catch (err) {
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
            const fm = parsed.frontmatter as Record<string, any>;
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
            } catch (err) {
              /* use defaults */
            }

            skills.push({
              id: name,
              name,
              description,
              status: 'enabled',
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
          } catch (err) {
            /* skip malformed files */
          }
        }
      };

      // 扫描内置技能
      const projectRoot = resolveProjectRoot();
      const builtinDir = join(projectRoot, 'app', 'src', 'builtin', 'skills');
      await scanDir(builtinDir, 'builtin');

      // 扫描用户技能
      const userSkillsDir = join(resolvePyappHome(), 'skills');
      await scanDir(userSkillsDir, 'user');

      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ skills, total: skills.length }));
    } catch (err) {
      this.sendError(res, err);
    }
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
          decodeURIComponent(skillId)
        ),
        pathMod.join(resolvePyappHome(), 'skills', decodeURIComponent(skillId)),
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
      } catch (err) {
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
      const installedIds = new Set(installed.map((s: any) => s.meta.id));

      const searchEngine = adapter.getSearchEngine();
      const allResults = await searchEngine.searchRemote('', {});

      const recommended = allResults
        .filter((r: any) => !installedIds.has(r.skill.id))
        .slice(0, limit)
        .map((r: any) => ({ ...r, installed: false }));

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
  private getSkillCategoryMap(installed: any[]): Record<string, number> {
    const map: Record<string, number> = {};

    for (const skill of installed) {
      const source = skill.meta.source || 'third_party';

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
  private getSkillSourceMap(installed: any[]): Record<string, number> {
    const map: Record<string, number> = {};

    for (const skill of installed) {
      const source = skill.meta.source || 'unknown';
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

      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ skill }));
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
      } else if (enabled === false) {
        await adapter.disableSkill(skillId);
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

  // ========== MCP Marketplace Handlers ==========

  /**
   * 处理 MCP 市场搜索请求 GET /v1/mcp/marketplace/search?query=xx&category=xx
   */
  private async handleMCPMarketplaceSearch(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      const parsedUrl = new URL(
        req.url!,
        `http://${req.headers.host || 'localhost'}`
      );
      const query = parsedUrl.searchParams.get('query') || '';
      const category = parsedUrl.searchParams.get('category') || undefined;
      const registry = parsedUrl.searchParams.get('registry') as
        | RegistryType
        | undefined;
      const sourceRegistry = parsedUrl.searchParams.get('sourceRegistry') as
        | ThirdPartyRegistry
        | undefined;

      const { mcpSystem } = await import('@modules/services/mcp');

      if (!mcpSystem || !mcpSystem.marketplace) {
        res.writeHead(503, {
          'Content-Type': 'application/json; charset=utf-8',
        });
        res.end(JSON.stringify({ error: { message: 'MCP 市场服务未初始化' } }));
        return;
      }

      const results = await mcpSystem.marketplace.search({
        query,
        category,
        registry,
        sourceRegistry,
      });

      if (!results || !Array.isArray(results)) {
        res.writeHead(200, {
          'Content-Type': 'application/json; charset=utf-8',
        });
        res.end(JSON.stringify([]));
        return;
      }

      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(results));
    } catch (err) {
      await handleError(err, {
        module: 'infra:http',
        action: 'mcp_marketplace_search',
      });
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(
        JSON.stringify({
          error: {
            message: '搜索失败',
            detail: err instanceof Error ? err.message : String(err),
          },
        })
      );
    }
  }

  /**
   * 处理获取 MCP 市场注册表列表 GET /v1/mcp/marketplace/registries
   * 返回可用第三方注册表源（GitHub/NPM/Smithery 等）
   */
  private async handleMCPMarketplaceRegistries(
    _req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      const { mcpSystem } = await import('@modules/services/mcp');

      if (!mcpSystem || !mcpSystem.marketplace) {
        res.writeHead(503, {
          'Content-Type': 'application/json; charset=utf-8',
        });
        res.end(JSON.stringify({ error: { message: 'MCP 市场服务未初始化' } }));
        return;
      }

      const marketplace = mcpSystem.marketplace;
      if (!marketplace.registryHub) {
        res.writeHead(503, {
          'Content-Type': 'application/json; charset=utf-8',
        });
        res.end(JSON.stringify({ error: { message: '注册表中心未初始化' } }));
        return;
      }

      const adapters = marketplace.registryHub.getAdapters();
      if (!adapters || !Array.isArray(adapters)) {
        res.writeHead(200, {
          'Content-Type': 'application/json; charset=utf-8',
        });
        res.end(JSON.stringify({ registries: [] }));
        return;
      }

      const registries = adapters
        .filter((a) => a && a.registryType === 'third_party')
        .map((a) => ({
          id: (a.sourceRegistry as string) || a.id,
          name: a.displayName || 'Unknown',
          sourceRegistry: a.sourceRegistry,
        }));

      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ registries }));
    } catch (err) {
      await handleError(err, {
        module: 'infra:http',
        action: 'mcp_registries',
      });
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(
        JSON.stringify({
          error: {
            message: '获取注册表列表失败',
            detail: err instanceof Error ? err.message : String(err),
          },
        })
      );
    }
  }

  /**
   * 处理获取 MCP 市场分类请求 GET /v1/mcp/marketplace/categories
   */
  private async handleMCPMarketplaceCategories(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      const { mcpSystem } = await import('@modules/services/mcp');

      if (!mcpSystem || !mcpSystem.marketplace) {
        res.writeHead(503, {
          'Content-Type': 'application/json; charset=utf-8',
        });
        res.end(JSON.stringify({ error: { message: 'MCP 市场服务未初始化' } }));
        return;
      }

      const categories = await mcpSystem.marketplace.getCategories();

      if (!categories || !Array.isArray(categories)) {
        res.writeHead(200, {
          'Content-Type': 'application/json; charset=utf-8',
        });
        res.end(JSON.stringify([]));
        return;
      }

      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(categories));
    } catch (err) {
      logger.error('获取 MCP 分类列表失败', err as Error);
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(
        JSON.stringify({
          error: {
            message: '获取分类列表失败',
            detail: err instanceof Error ? err.message : String(err),
          },
        })
      );
    }
  }

  /**
   * 处理获取 MCP 服务器详情请求 GET /v1/mcp/marketplace/servers/:serverId
   */
  private async handleMCPMarketplaceServerDetail(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    serverId: string
  ): Promise<void> {
    try {
      const { mcpSystem } = await import('@modules/services/mcp');

      if (!mcpSystem || !mcpSystem.marketplace) {
        res.writeHead(503, {
          'Content-Type': 'application/json; charset=utf-8',
        });
        res.end(JSON.stringify({ error: { message: 'MCP 市场服务未初始化' } }));
        return;
      }

      const detail = await mcpSystem.marketplace.getServerDetail(serverId);

      if (!detail) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'Server not found' } }));
        return;
      }

      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(detail));
    } catch (err) {
      logger.error('获取 MCP 服务器详情失败', err as Error);
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(
        JSON.stringify({
          error: {
            message: '获取服务器详情失败',
            detail: err instanceof Error ? err.message : String(err),
          },
        })
      );
    }
  }

  /**
   * 处理获取已安装 MCP 服务器列表 GET /v1/mcp/marketplace/installed
   */
  private async handleMCPInstalledServers(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      const { mcpSystem } = await import('@modules/services/mcp');

      if (!mcpSystem || !mcpSystem.marketplace) {
        res.writeHead(503, {
          'Content-Type': 'application/json; charset=utf-8',
        });
        res.end(JSON.stringify({ error: { message: 'MCP 市场服务未初始化' } }));
        return;
      }

      const servers = mcpSystem.marketplace.getInstalledServers();
      if (!servers || !Array.isArray(servers)) {
        res.writeHead(200, {
          'Content-Type': 'application/json; charset=utf-8',
        });
        res.end(JSON.stringify([]));
        return;
      }

      const detailed = servers.map((s) => {
        const detail = mcpSystem.marketplace.getInstalledServerDetail(s.name);
        return {
          ...s,
          connected: detail.connected,
          configInFile: detail.config ? true : false,
        };
      });

      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(detailed));
    } catch (err) {
      await handleError(err, {
        module: 'infra:http',
        action: 'mcp_installed_list',
      });
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(
        JSON.stringify({
          error: {
            message: '获取已安装服务器列表失败',
            detail: err instanceof Error ? err.message : String(err),
          },
        })
      );
    }
  }

  /**
   * 处理安装 MCP 服务器请求 POST /v1/mcp/marketplace/servers/:serverId/install
   */
  private async handleMCPInstallServer(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    serverId: string
  ): Promise<void> {
    try {
      const { mcpSystem } = await import('@modules/services/mcp');

      if (!mcpSystem || !mcpSystem.marketplace) {
        res.writeHead(503, {
          'Content-Type': 'application/json; charset=utf-8',
        });
        res.end(JSON.stringify({ error: { message: 'MCP 市场服务未初始化' } }));
        return;
      }

      await mcpSystem.marketplace.install(serverId);

      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: true, serverId }));
    } catch (err) {
      await handleError(err, {
        module: 'infra:http',
        action: 'mcp_install_server',
        context: { serverId },
      });
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(
        JSON.stringify({
          error: {
            message: `安装服务器失败: ${serverId}`,
            detail: err instanceof Error ? err.message : String(err),
          },
        })
      );
    }
  }

  /**
   * 处理卸载 MCP 服务器请求 POST /v1/mcp/marketplace/servers/:serverId/uninstall
   */
  private async handleMCPUninstallServer(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    serverId: string
  ): Promise<void> {
    try {
      const { mcpSystem } = await import('@modules/services/mcp');

      if (!mcpSystem || !mcpSystem.marketplace) {
        res.writeHead(503, {
          'Content-Type': 'application/json; charset=utf-8',
        });
        res.end(JSON.stringify({ error: { message: 'MCP 市场服务未初始化' } }));
        return;
      }

      await mcpSystem.marketplace.uninstall(serverId);

      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: true, serverId }));
    } catch (err) {
      logger.error(`卸载 MCP 服务器失败: ${serverId}`, err as Error);
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(
        JSON.stringify({
          error: {
            message: `卸载服务器失败: ${serverId}`,
            detail: err instanceof Error ? err.message : String(err),
          },
        })
      );
    }
  }

  /**
   * 处理切换 MCP 服务器启用状态 POST /v1/mcp/marketplace/servers/:serverId/toggle
   */
  private async handleMCPToggleServer(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    serverId: string
  ): Promise<void> {
    try {
      const body = await this.readRequestBody(req);
      const parsedBody = body ? JSON.parse(body) : {};
      const enabled = parsedBody.enabled;

      if (enabled === undefined) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            error: { message: 'enabled field is required (true/false)' },
          })
        );
        return;
      }

      const { mcpSystem } = await import('@modules/services/mcp');

      if (!mcpSystem || !mcpSystem.marketplace) {
        res.writeHead(503, {
          'Content-Type': 'application/json; charset=utf-8',
        });
        res.end(JSON.stringify({ error: { message: 'MCP 市场服务未初始化' } }));
        return;
      }

      await mcpSystem.marketplace.toggleServer(serverId, enabled);

      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: true, serverId, enabled }));
    } catch (err) {
      await handleError(err, {
        module: 'infra:http',
        action: 'mcp_toggle_server',
        context: { serverId },
      });
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(
        JSON.stringify({
          error: {
            message: `切换服务器状态失败: ${serverId}`,
            detail: err instanceof Error ? err.message : String(err),
          },
        })
      );
    }
  }

  /**
   * 处理验证 MCP 服务器连接 POST /v1/mcp/servers/:serverId/verify
   */
  private async handleMCPVerifyServer(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    serverId: string
  ): Promise<void> {
    try {
      const { getMCPServerManager } =
        await import('@modules/services/mcp/MCPServerManager');
      const { mcpSystem } = await import('@modules/services/mcp');

      const manager = getMCPServerManager();
      const detail = mcpSystem.marketplace.getInstalledServerDetail(serverId);

      if (!detail.metadata) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            success: false,
            error: `服务器 "${serverId}" 未安装`,
          })
        );
        return;
      }

      const server = manager.getServer(serverId);
      if (!server) {
        res.writeHead(200, {
          'Content-Type': 'application/json; charset=utf-8',
        });
        res.end(
          JSON.stringify({
            success: false,
            connected: false,
            status: 'not_found',
          })
        );
        return;
      }

      // 尝试连接
      const wasConnected = detail.connected;
      const success = await server.connect();

      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(
        JSON.stringify({
          success,
          connected: success,
          status: success ? 'connected' : 'failed',
          wasConnected,
        })
      );
    } catch (err) {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(
        JSON.stringify({
          success: false,
          connected: false,
          status: 'error',
          error: err instanceof Error ? err.message : String(err),
        })
      );
    }
  }

  /**
   * 处理列出所有 MCP 工具 GET /v1/mcp/tools
   */
  private async handleMCPListTools(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      const { getMCPServerManager } =
        await import('@modules/services/mcp/MCPServerManager');
      const { mcpSystem } = await import('@modules/services/mcp');
      const manager = getMCPServerManager();
      const serverInfos = manager.getServerInfos();

      const tools: Array<{
        name: string;
        description: string;
        server: string;
        inputSchema: Record<string, unknown>;
        enabled: boolean;
      }> = [];

      for (const info of serverInfos) {
        for (const tool of info.tools || []) {
          const enabled = !mcpSystem.marketplace.isToolDisabled(
            info.name,
            tool.name
          );
          tools.push({
            name: tool.name,
            description: tool.description || '',
            server: info.name,
            inputSchema: (tool.inputSchema as Record<string, unknown>) || {},
            enabled,
          });
        }
      }

      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ tools, total: tools.length }));
    } catch (err) {
      this.sendError(res, err);
    }
  }

  /**
   * 处理切换 MCP 工具启用状态 PATCH /v1/mcp/tools/:toolName/toggle
   * body: { enabled: boolean, server?: string }
   */
  private async handleMCPToggleTool(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    toolName: string
  ): Promise<void> {
    try {
      const body = await this.readRequestBody(req);
      const parsedBody = body ? JSON.parse(body) : {};
      const enabled = parsedBody.enabled;
      const serverName = parsedBody.server as string | undefined;

      if (enabled === undefined) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            error: { message: 'enabled field is required (true/false)' },
          })
        );
        return;
      }

      // 工具级启用/禁用通过 marketplace 的 tool toggle 实现
      const { mcpSystem } = await import('@modules/services/mcp');
      await mcpSystem.marketplace.toggleTool(
        serverName || toolName,
        toolName,
        enabled
      );

      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: true, tool: toolName, enabled }));
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
          (await (coreAPI as any).sendTaskMessage?.(taskId, message)) || '';
      } catch (err) {
        // 降级：通过 executor 直接执行
        const { coordinator } = await import('@modules/core/Coordinator');
        const task = (coordinator as any).getTask(taskId);
        if (task && typeof (task as any).sendMessage === 'function') {
          reply = await (task as any).sendMessage(message);
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
      let orchestrator: any = null;
      try {
        const mod = await import('@modules/tasks/LongRunningTaskOrchestrator');
        orchestrator = mod.getOrchestrator(taskId);
      } catch (err) {
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
      let orchestrator: any = null;
      try {
        const m = await import('@modules/tasks/LongRunningTaskOrchestrator');
        orchestrator = m.getOrchestrator(taskId);
      } catch (err) {
        logger.debug('Operation skipped', {
          error: err instanceof Error ? err.message : String(err),
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
      let orchestrator: any = null;
      try {
        const m = await import('@modules/tasks/LongRunningTaskOrchestrator');
        orchestrator = m.getOrchestrator(taskId);
      } catch (err) {
        logger.debug('Operation skipped', {
          error: err instanceof Error ? err.message : String(err),
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
      let orchestrator: any = null;
      try {
        const m = await import('@modules/tasks/LongRunningTaskOrchestrator');
        orchestrator = m.getOrchestrator(taskId);
      } catch (err) {
        logger.debug('Operation skipped', {
          error: err instanceof Error ? err.message : String(err),
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
      let list: any[] = [];
      try {
        const m = await import('@modules/tasks/LongRunningTaskOrchestrator');
        list = m.getAllOrchestrators().map((o: any) => o.getStatus());
      } catch (err) {
        logger.debug('Operation skipped', {
          error: err instanceof Error ? err.message : String(err),
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
      let orchestrator: any = null;
      try {
        const m = await import('@modules/tasks/LongRunningTaskOrchestrator');
        orchestrator = m.getOrchestrator(taskId);
      } catch (err) {
        logger.debug('Operation skipped', {
          error: err instanceof Error ? err.message : String(err),
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

  private async handleCreateSkill(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      const body = await this.readRequestBody(req);
      const { skillId, sourceUrl } = JSON.parse(body);

      if (!skillId) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'skillId is required' } }));
        return;
      }

      const adapter = await this.getClawHubAdapter();
      const skill = await adapter.installSkill(skillId, sourceUrl);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(skill));
      this.broadcastEvent('skill:created', { skill });
    } catch (err) {
      this.sendError(res, err);
    }
  }

  private async handleUpdateSkillById(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    skillId: string
  ): Promise<void> {
    try {
      const adapter = await this.getClawHubAdapter();
      const skill = await adapter.updateSkill(skillId);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(skill));
      this.broadcastEvent('skill:updated', { skill });
    } catch (err) {
      this.sendError(res, err);
    }
  }

  private async handleDeleteSkill(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    skillId: string
  ): Promise<void> {
    try {
      const adapter = await this.getClawHubAdapter();
      await adapter.uninstallSkill(skillId);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({}));
      this.broadcastEvent('skill:deleted', { skillId });
    } catch (err) {
      this.sendError(res, err);
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

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          id: channelId,
          name: name || channelAfterDyn.name,
          type: channelAfterDyn.type,
          enabled: enabled !== undefined ? enabled : channelAfterDyn.enabled,
          connected: latestChannel?.connected ?? channelAfterDyn.connected,
          registered: true,
          config: latestConfig?.options || {},
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
          const dynRegistered = await this.tryDynamicRegister(
            config.type,
            config.options
          );
          if (dynRegistered) {
            registeredCount++;
            // 恢复持久化的配置（含 enabled 状态）
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
          logger.warning(msg);
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
      logger.error('通道配置应用失败', err as Error);
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
      channelRegistry.updateConfig(channelType, {
        name: entry.name,
        enabled: false,
        options: {
          ...(channelRegistry.getConfig(channelType)?.options || {}),
          ...(config || {}),
        },
      });

      // 4. 绑定入站消息处理器
      this.bindChannelMessageHandler(channelType, plugin);

      return true;
    } catch (err) {
      logger.error(`tryDynamicRegister(${channelType}) 失败`, {
        error: String(err),
      });
      return false;
    }
  }

  /** 绑定入站消息 → AI → 出站 回路 */
  private bindChannelMessageHandler(
    channelType: string,
    plugin: IChannelPlugin
  ): void {
    if (!plugin.inbound) return;

    const _processingMessages = new Set<string>();

    plugin.inbound.setMessageHandler(
      async (message: import('@modules/channels/types').MessageContext) => {
        if (_processingMessages.has(message.messageId)) return;
        _processingMessages.add(message.messageId);

        try {
          const sender = message.senderName || message.senderId || 'unknown';
          const label = channelType.toUpperCase();
          logger.info(`[${label}] 收到消息: ${sender}`);
          logger.debug(message.content);

          const coreAPI = getCoreAPI();
          const response = await coreAPI.chat({
            content: message.content,
            sessionId: message.conversationId ?? message.senderId,
            metadata: {
              channel: message.channelId,
              sender: message.senderId,
              messageType: message.messageType,
              isDirectMessage: message.isDirectMessage,
              rawPayload: message.rawPayload,
            },
          });

          if (response.content && plugin.outbound) {
            logger.info(`[${label}] 回复消息`);
            logger.debug(response.content);

            await plugin.outbound.sendText(
              message.conversationId ?? message.senderId,
              response.content
            );
          }
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
        (m: any) => !!m.metadata?.vectorId
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
        (m: any) =>
          now - new Date(m.createdAt).getTime() < 7 * 24 * 60 * 60 * 1000
      ).length;

      const expiring = await mm.getExpiringMemories();
      const oldestMs =
        allMemories.length > 0
          ? Math.min(
              ...allMemories.map((m: any) => new Date(m.createdAt).getTime())
            )
          : now;
      const oldestMemoryAge = Math.floor(
        (now - oldestMs) / (24 * 60 * 60 * 1000)
      );

      const indexedCount = mm.getRetriever().getIndexSize();
      const vectorCacheSize = allMemories.filter(
        (m: any) => !!m.metadata?.vectorId
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
        allMemories.map((m: any) => ({
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

      const { exec } = await import('child_process');
      const { promisify } = await import('util');
      const execAsync = promisify(exec);

      if (process.platform === 'win32') {
        await execAsync(`start "" "${filePath}"`);
      } else if (process.platform === 'darwin') {
        await execAsync(`open "${filePath}"`);
      } else {
        await execAsync(`xdg-open "${filePath}"`);
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
      logger.error('读取文件失败', { path: req.url, error: message });
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
      } = await import('@modules/core/paths');

      if (path.isAbsolute(rawPath)) {
        if (fs.existsSync(rawPath)) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ resolvedPath: rawPath, exists: true }));
          return;
        }
        // 绝对路径不存在时，提取文件名尝试在基础目录中搜索
        // 处理文件被移动/重命名的情况
        const fileName = path.basename(rawPath);
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
          const candidate = path.join(baseDir, fileName);
          if (fs.existsSync(candidate)) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ resolvedPath: candidate, exists: true }));
            return;
          }
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ resolvedPath: rawPath, exists: false }));
        return;
      }

      if (rawPath.startsWith('~')) {
        const pyappHome = resolvePyappHome();
        const withoutTilde = rawPath.replace(/^~[/\\]?/, '');
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
      logger.error('解析文件路径失败', { path: req.url, error: message });
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
      const officeExts = ['.pdf', '.docx', '.pptx'];

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
      let checkpoint = allCheckpoints.find((cp) => cp.id === cpId);
      if (!checkpoint) {
        const cp = await (chatManager as any).getCheckpoint?.(cpId);
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
